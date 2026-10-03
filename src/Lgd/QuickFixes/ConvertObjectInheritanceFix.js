const path = require('path');
const vscode = require('vscode');
const { parse, parseExpression } = require('@babel/parser');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const ObjectInheritanceContracts = require('./ObjectInheritanceContracts');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const { maskCode } = require('../../Compilers/LgdInfer');
const { typedParamGroups } = require('../../Compilers/LgdTypedParams');
const { collectScopes, collectBindings, visibleBindings } = require('../../Compilers/LgdBaseChecker');

/** @description Converts only the established OLOO allocation lifecycle without guessing JSDoc type aliases. */
class ConvertObjectInheritanceFix extends DiagnosticQuickFix
{
    constructor() { super('convertObjectInheritance'); }

    /** @description Resolves the real base, preserves source methods, and validates the complete class preview. */
    async createProposal(context, fix)
    {
        const { source, document, languageService, state } = context;
        const options = languageService.getOutputOptions(document);
        if(options.javascriptObjectModel === 'class' || fix.kind !== this.kind)
        {
            return null;
        }

        const compiler = LgdCompiler.create();
        const parsed = compiler.parse(source.text, state.externals);
        const declaration = parsed.declarations.find(candidate => candidate.start === fix.declarationStart && candidate.name === fix.name);
        if(!declaration || declaration.kind || declaration.typeName !== 'Object' || !declaration.readonly)
        {
            return null;
        }

        const heritageTags = Array.from((declaration.jsdoc || '').matchAll(/@(?:extends|augments)\b/g));
        if(heritageTags.length !== 1)
        {
            return null;
        }

        const shape = this._readShape(source.text, declaration, parsed.allDeclarations);
        if(!shape)
        {
            return null;
        }

        const snapshots = context.snapshots.slice();
        const base = await this._knownBase(context, { parsed: parsed, declaration: declaration, baseName: shape.baseName, baseTypeName: fix.baseTypeName }, snapshots);
        if(!base)
        {
            return null;
        }

        const contracts = ObjectInheritanceContracts.plan(context, base, shape);
        if(!contracts)
        {
            return null;
        }

        shape.overrides = contracts.overrides;
        const newText = this._convert(source.text, declaration, shape);
        const previewText = source.text.slice(0, declaration.start) + newText + source.text.slice(declaration.end);
        const originalErrors = compiler.compileToJs(source.text, state.externals, options).errors;
        const preview = compiler.compileToJs(previewText, contracts.externals, options);
        const delta = newText.length - (declaration.end - declaration.start);
        if(!this._validErrors(originalErrors, preview.errors, declaration, delta))
        {
            return null;
        }

        const signature = JSON.stringify(options);
        if(contracts.preparation)
        {
            return { ...contracts.preparation, snapshots: snapshots,
                validate: () => JSON.stringify(languageService.getOutputOptions(document)) === signature };
        }

        return { title: `Convert '${declaration.name}' to LGD class : ${shape.baseName}`,
            target: source, snapshots: snapshots, offset: declaration.start, endOffset: declaration.end, newText: newText,
            validate: () => JSON.stringify(languageService.getOutputOptions(document)) === signature };
    }

    /** @description Reads an offset-preserving JavaScript view while retaining every original LGD method body. */
    _readShape(source, declaration, declarations)
    {
        const start = declaration.initializerStart;
        let normalized = source.slice(start, declaration.initializerEnd);
        for(const child of declarations.slice().sort((left, right) => right.headStart - left.headStart))
        {
            if(child.headStart <= start || child.nameStart >= declaration.initializerEnd || child.kind)
            {
                continue;
            }

            const headStart = child.typeStart - (child.readonly ? 'readonly '.length : 0);
            const length = child.nameStart - headStart;
            if(length < 'let '.length)
            {
                return null;
            }

            normalized = normalized.slice(0, headStart - start) + 'let '.padEnd(length) + normalized.slice(child.nameStart - start);
        }

        normalized = this._eraseSignatureTypes(normalized, declaration, declarations);
        try
        {
            const object = parseExpression(normalized);
            const methods = object.properties;
            const ordinaryMethods = methods?.every(method => this._ordinaryMethod(method));
            if(object.type !== 'ObjectExpression' || !ordinaryMethods)
            {
                return null;
            }

            const names = methods.map(method => method.key.name);
            if(new Set(names).size !== names.length || names.includes(declaration.name) || names.includes('constructor'))
            {
                return null;
            }

            const factory = methods.find(method => method.key.name === 'create');
            if(!factory || factory.async || factory.params.some(parameter => !this._simpleParameter(parameter)))
            {
                return null;
            }

            const statements = factory.body.body;
            const local = statements[0]?.declarations?.[0];
            const directReturn = statements.length === 1 && statements[0].type === 'ReturnStatement';
            const call = directReturn ? statements[0].argument : local?.init;
            const baseCall = call?.arguments?.[0];
            const returned = statements[1]?.argument;
            const hasComments = object.comments?.some(comment => comment.start > factory.body.start && comment.end < factory.body.end);
            const allocation = statements.length === 2 && statements[0].type === 'VariableDeclaration' && statements[0].declarations.length === 1;
            const returnedLocal = local?.id?.type === 'Identifier' && returned?.type === 'Identifier' && returned.name === local.id.name;
            const returnsLocal = statements[1]?.type === 'ReturnStatement' && returnedLocal;
            const assignment = this._memberCall(call, 'Oloo', 'assign') && call.arguments.length === 2;
            const target = call?.arguments?.[1];
            const targetMatches = target?.type === 'Identifier' && target.name === declaration.name;
            const baseName = baseCall?.callee?.object?.name;
            const createsBase = typeof baseName === 'string' && this._memberCall(baseCall, baseName, 'create');
            const knownLifecycle = directReturn || allocation && returnsLocal;
            if(!knownLifecycle || !assignment || !targetMatches || !createsBase || hasComments)
            {
                return null;
            }

            return { object: object, factory: factory, baseCall: baseCall, baseName: baseCall.callee.object.name, start: start };
        }
        catch
        {
            return null;
        }
    }

    /** @description Masks compiler-recognized LGD signature types without moving source offsets or changing the replacement. */
    _eraseSignatureTypes(normalized, declaration, declarations)
    {
        const ranges = [];
        for(const current of [ declaration, ...declarations.filter(candidate => candidate !== declaration) ])
        {
            const start = current.initializerStart - declaration.initializerStart;
            if(start < 0 || start >= normalized.length || current.kind)
            {
                continue;
            }

            for(const group of typedParamGroups(current))
            {
                if(group.returnTypeName)
                {
                    ranges.push({ start: start + group.returnTypeStart, end: start + group.returnTypeEnd });
                }

                for(const parameter of group.params)
                {
                    if(parameter.typeName)
                    {
                        ranges.push({ start: start + parameter.typeStart, end: start + parameter.typeEnd });
                    }
                }
            }
        }

        for(const range of ranges)
        {
            const erased = normalized.slice(range.start, range.end).replace(/[^\n\r]/g, ' ');
            normalized = normalized.slice(0, range.start) + erased + normalized.slice(range.end);
        }

        return normalized;
    }

    /** @description Retains simple identifier, defaulted and rest parameters exactly in the generated constructor. */
    _simpleParameter(parameter)
    {
        if(parameter.type === 'Identifier')
        {
            return true;
        }

        if(parameter.type === 'AssignmentPattern')
        {
            return parameter.left.type === 'Identifier';
        }

        return parameter.type === 'RestElement' && parameter.argument.type === 'Identifier';
    }

    /** @description Recognizes an ordinary nonoptional call without computed member access. */
    _memberCall(call, owner, name)
    {
        if(call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.computed)
        {
            return false;
        }

        const ownerMatches = call.callee.object.type === 'Identifier' && call.callee.object.name === owner;
        return ownerMatches && call.callee.property.type === 'Identifier' && call.callee.property.name === name;
    }

    /** @description Requires a lexical legacy object or a snapshotted CommonJS object with matching documented identity. */
    async _knownBase(context, evidence, snapshots)
    {
        const { parsed, declaration, baseName, baseTypeName } = evidence;
        const content = context.source.text;
        const masked = maskCode(content, true);
        const bindings = collectBindings({ content: content, masked: masked, declarations: parsed.allDeclarations,
            scopes: collectScopes(masked), externals: context.state.externals });
        const base = visibleBindings(bindings, declaration.headStart).get(baseName);
        const binding = bindings.find(candidate => candidate.name === baseName && candidate.declaration === base);
        if(!base || base.kind === 'class' || !binding || binding.offset >= declaration.headStart)
        {
            return false;
        }

        if(base.sourcePath)
        {
            return this._knownLgdObject(base, baseName, baseTypeName, snapshots);
        }

        if(base.initializerText?.trim().startsWith('{'))
        {
            const hasFactory = base.members.some(member => member.name === 'create' && member.kind === 'method');
            return hasFactory && this._matchesType(baseName, baseTypeName, base.jsdoc) && { declaration: base, snapshot: context.source };
        }

        const required = (/^\s*require\(\s*(?<quote>["'])(?<specifier>\.[^"']*)\k<quote>\s*\)\s*$/).exec(base.initializerText || '');
        if(!required || context.document.uri.scheme !== 'file')
        {
            return false;
        }

        const specifier = required.groups.specifier;
        const extension = path.extname(specifier);
        if(extension && extension !== '.js')
        {
            return false;
        }

        const filename = path.resolve(path.dirname(context.document.uri.fsPath), extension ? specifier : `${specifier}.js`);
        try
        {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
            const snapshot = DiagnosticQuickFix.snapshot(document);
            const program = parse(snapshot.text, { sourceType: 'unambiguous' }).program;
            const exports = program.body.filter(statement => this._isCommonJsExport(statement));

            if(exports.length !== 1 || exports[0].expression.right.type !== 'Identifier')
            {
                return false;
            }

            const exportName = exports[0].expression.right.name;
            const declarations = program.body.filter(candidate => candidate.type === 'VariableDeclaration' && candidate.declarations.length === 1);
            const statement = declarations.find(candidate => candidate.declarations[0].id.name === exportName);

            const object = statement?.declarations[0].init;
            const create = object?.type === 'ObjectExpression' && object.properties.find(member => member.key?.name === 'create');
            const docs = statement?.leadingComments?.map(comment => comment.value).join('\n');
            const validFactory = create && this._ordinaryMethod(create) && !create.async;
            if(!validFactory || !this._matchesType(baseName, baseTypeName, docs))
            {
                return false;
            }

            snapshots.push(snapshot);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /** @description Validates a resolved LGD object export against the dependency snapshot already checked by the editor. */
    _knownLgdObject(entry, baseName, baseTypeName, snapshots)
    {
        const snapshot = snapshots.find(candidate => candidate.document.uri.scheme === 'file' && candidate.document.uri.fsPath === entry.sourcePath);
        if(!entry.sourcePath.endsWith('.lgd') || !snapshot || snapshot.text !== entry.sourceText)
        {
            return false;
        }

        const parsed = LgdCompiler.create().parse(snapshot.text);
        const declaration = parsed.declarations.find(candidate => candidate.name === entry.exportName);
        if(!declaration || declaration.kind || declaration.typeName !== 'Object' || !declaration.initializerText.trimStart().startsWith('{'))
        {
            return false;
        }

        const hasFactory = declaration.members.some(member => member.name === 'create' && member.kind === 'method');
        return hasFactory && this._matchesType(baseName, baseTypeName, declaration.jsdoc) && { declaration: declaration, snapshot: snapshot, entry: entry };
    }

    /** @description Excludes accessors, computed names, generators and property initializers. */
    _ordinaryMethod(method)
    {
        const ordinary = method.type === 'ObjectMethod' && !method.computed && method.kind === 'method';
        return ordinary && !method.generator && method.key.type === 'Identifier';
    }

    /** @description Recognizes only a direct CommonJS export assignment. */
    _isCommonJsExport(statement)
    {
        if(statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression' || statement.expression.operator !== '=')
        {
            return false;
        }

        const target = statement.expression.left;
        const direct = target.type === 'MemberExpression' && !target.computed;
        return direct && target.object.name === 'module' && target.property.name === 'exports';
    }

    /** @description Accepts a runtime name or an explicitly documented alias, never a guessed Type suffix. */
    _matchesType(baseName, baseTypeName, docs)
    {
        const declaredTypes = Array.from((docs || '').matchAll(/@type\s*{(?<name>[$A-Z_a-z][\w$]*)}/g), match => match.groups.name);
        return baseTypeName === baseName || declaredTypes.includes(baseTypeName);
    }

    /** @description Rewrites only declaration syntax, the recognized factory, and object member separators. */
    _convert(source, declaration, shape)
    {
        const { start, object, factory, baseCall } = shape;
        const parameters = source.slice(start + factory.key.end, start + factory.body.start).trim();
        const callTail = source.slice(start + baseCall.callee.end, start + baseCall.end);
        const open = maskCode(callTail).indexOf('(');
        const argumentsText = callTail.slice(open + 1, -1);
        const edits = [{ start: factory.start, end: factory.end,
            text: `${declaration.name}${parameters} : base(${argumentsText}) {}` }];
        const factorySignature = declaration.methodTypedParams?.find(group => group.name === 'create');
        if(factorySignature?.returnTypeName)
        {
            edits.push({ start: factorySignature.returnTypeStart, end: factorySignature.returnTypeEnd, text: '' });
        }

        for(const method of object.properties)
        {
            if(shape.overrides?.includes(method.key.name))
            {
                const signature = declaration.methodTypedParams?.find(group => group.name === method.key.name);
                const offset = signature?.methodStart ?? method.start;
                edits.push({ start: offset, end: offset, text: 'override ' });
            }

            const tail = maskCode(source.slice(start + method.end, declaration.initializerEnd));
            const comma = (/^\s*,/).exec(tail);
            if(comma)
            {
                const offset = method.end + comma[0].length - 1;
                edits.push({ start: offset, end: offset + 1, text: '' });
            }
        }

        let body = source.slice(start, declaration.initializerEnd);
        for(const edit of edits.sort((left, right) => right.start - left.start))
        {
            body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
        }

        const docs = source.slice(declaration.start, declaration.headStart)
            .replace(/@(?:extends|augments)\s*{[^}]*}/g, '');
        const exported = declaration.exported ? 'export ' : '';
        return `${docs}${declaration.indent}${exported}class ${declaration.name} : ${shape.baseName}${body}`;
    }

    /** @description Suppresses proposals introducing errors while allowing unrelated existing diagnostics to remain. */
    _validErrors(original, preview, declaration, delta)
    {
        return preview.every(error => original.some(previous =>
        {
            if(previous.offset >= declaration.start && previous.offset < declaration.end)
            {
                return false;
            }

            const offset = previous.offset >= declaration.end ? previous.offset + delta : previous.offset;
            return error.offset === offset && error.code === previous.code && error.message === previous.message;
        }));
    }
}

module.exports = ConvertObjectInheritanceFix;
