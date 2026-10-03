const path = require('path');
const vscode = require('vscode');
const { parse } = require('@babel/parser');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const ObjectInheritanceContracts = require('./ObjectInheritanceContracts');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdObjectInheritance = require('../../Compilers/LgdObjectInheritance');
const LgdDocComment = require('../../Compilers/LgdDocComment');
const { maskCode } = require('../../Compilers/LgdInfer');
const LgdFactoryMigration = require('../../Compilers/LgdFactoryMigration');
const { collectScopes, collectBindings, visibleBindings } = require('../../Compilers/LgdBaseChecker');

/** @description Converts only the established OLOO allocation lifecycle without guessing JSDoc type aliases. */
class ConvertObjectInheritanceFix extends DiagnosticQuickFix
{
    /** @description Exposes conversion and optional base preparation as separate named actions. */
    constructor(prepareBaseOnly = false)
    {
        super(prepareBaseOnly ? 'prepareObjectInheritance' : 'convertObjectInheritance');
        this.prepareBaseOnly = prepareBaseOnly;
    }

    /** @description Resolves the real base, preserves source methods, and validates the complete class preview. */
    async createProposal(context, fix)
    {
        const { source, document, languageService, state } = context;
        const options = languageService.getOutputOptions(document);
        if(fix.kind !== 'convertObjectInheritance')
        {
            return null;
        }

        const compiler = LgdCompiler.create();
        const parsed = compiler.parse(source.text, state.externals);
        const declaration = parsed.declarations.find(candidate => candidate.start === fix.declarationStart && candidate.name === fix.name);
        if(!declaration || declaration.kind && declaration.kind !== 'class' || declaration.typeName !== 'Object' || !declaration.readonly)
        {
            return null;
        }

        const heritageTags = LgdObjectInheritance.tags(declaration);
        if(heritageTags.length > 1 || !declaration.kind && heritageTags.length !== 1)
        {
            return null;
        }

        const shape = LgdFactoryMigration.read(source.text, declaration, parsed.allDeclarations);
        const baseTypeName = fix.baseTypeName ?? this._documentedBase(declaration);
        if(!shape)
        {
            return null;
        }

        const snapshots = context.snapshots.slice();
        const evidence = { parsed: parsed, declaration: declaration, shape: shape, baseTypeName: baseTypeName };
        const base = shape.rootFactory ? null : await this._findKnownBase(context, evidence, snapshots);
        if(!shape.rootFactory && (!base || options.javascriptObjectModel === 'class' && base.declaration?.kind !== 'class'))
        {
            return null;
        }

        if(base?.declaration?.kind === 'class' && !LgdFactoryMigration.safeClassBase(base.snapshot.text, base.declaration, base.declarations, shape))
        {
            return null;
        }

        const contracts = shape.rootFactory ? { externals: state.externals, overrides: [], preparation: null } : ObjectInheritanceContracts.plan(context, base, shape);
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
        if(!this._validErrors(originalErrors, preview, declaration, delta))
        {
            return null;
        }

        const signature = JSON.stringify(options);
        if(this.prepareBaseOnly)
        {
            if(!contracts.preparation)
            {
                return null;
            }

            return { ...contracts.preparation, snapshots: snapshots,
                validate: () => JSON.stringify(languageService.getOutputOptions(document)) === signature };
        }

        let title = `Convert '${declaration.name}' to LGD class : ${shape.baseName}`;
        if(declaration.kind === 'class')
        {
            title = shape.rootFactory ? `Migrate '${declaration.name}' factory to instance initialization` : `Migrate '${declaration.name}' to constructor and : ${shape.baseName}`;
        }

        if(contracts.preparation)
        {
            title += ` and make ${contracts.virtualTargets} virtual`;
        }

        return { title: title, additionalEdits: contracts.preparation ? [contracts.preparation] : [],
            target: source, snapshots: snapshots, offset: declaration.start, endOffset: declaration.end, newText: newText,
            validate: () => JSON.stringify(languageService.getOutputOptions(document)) === signature };
    }

    /** @description Reads a single explicit heritage annotation without guessing a legacy type suffix. */
    _documentedBase(declaration)
    {
        return LgdObjectInheritance.tags(declaration)[0]?.baseTypeName || null;
    }

    /** @description Resolves exactly one proven runtime base, including explicitly documented legacy aliases. */
    async _findKnownBase(context, evidence, snapshots)
    {
        const { parsed, declaration, shape, baseTypeName } = evidence;
        if(shape.baseName && declaration.baseName && shape.baseName !== declaration.baseName)
        {
            return null;
        }

        const explicitName = shape.baseName || declaration.baseName;
        let names = [explicitName];
        if(!explicitName)
        {
            const content = context.source.text;
            const masked = maskCode(content, true);
            const bindings = collectBindings({ content: content, masked: masked, declarations: parsed.allDeclarations,
                scopes: collectScopes(masked), externals: context.state.externals });
            names = [...visibleBindings(bindings, declaration.headStart).keys()];
        }

        const matches = [];
        for(const name of names)
        {
            const candidateSnapshots = snapshots.slice();
            const base = await this._knownBase(context, { parsed: parsed, declaration: declaration, baseName: name, baseTypeName: baseTypeName }, candidateSnapshots);
            if(base)
            {
                matches.push({ base: base, name: name, snapshots: candidateSnapshots });
            }
        }

        if(matches.length !== 1)
        {
            return null;
        }

        shape.baseName = matches[0].name;
        snapshots.push(...matches[0].snapshots.slice(snapshots.length));
        return matches[0].base;
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
        if(!base || !binding || binding.offset >= declaration.headStart)
        {
            return false;
        }

        if(base.sourcePath)
        {
            return this._knownLgdObject(base, baseName, baseTypeName, snapshots);
        }

        if(base.kind === 'class')
        {
            if(parsed.errors.some(error => error.severity !== 'warning' && error.offset >= base.start && error.offset < base.end))
            {
                return false;
            }

            return this._matchesType(baseName, baseTypeName, base.jsdoc) && { declaration: base, snapshot: context.source, declarations: parsed.allDeclarations };
        }

        if(base.initializerText?.trim().startsWith('{'))
        {
            const hasFactory = base.members.some(member => member.name === 'create' && member.kind === 'method');
            return hasFactory && this._matchesType(baseName, baseTypeName, base.jsdoc) && { declaration: base, snapshot: context.source, declarations: parsed.allDeclarations };
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
            const validFactory = create && LgdFactoryMigration._ordinaryMethod(create) && !create.async;
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
        if(!declaration || declaration.kind && declaration.kind !== 'class' || declaration.typeName !== 'Object' || !declaration.initializerText.trimStart().startsWith('{'))
        {
            return false;
        }

        const invalidConstructor = parsed.errors.some(error => error.code === 'lgd.constructor.returnValue' && error.offset >= declaration.start && error.offset < declaration.end);
        if(declaration.kind === 'class' && (!declaration.contractSyntaxComplete || invalidConstructor))
        {
            return false;
        }

        const hasFactory = declaration.kind === 'class' || declaration.members.some(member => member.name === 'create' && member.kind === 'method');
        const knownType = hasFactory && this._matchesType(baseName, baseTypeName, declaration.jsdoc);
        return knownType && { declaration: declaration, snapshot: snapshot, entry: entry, declarations: parsed.allDeclarations };
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
        return baseTypeName === null || baseTypeName === baseName || declaredTypes.includes(baseTypeName);
    }

    /** @description Rewrites only declaration syntax, the recognized factory, and object member separators. */
    _convert(source, declaration, shape)
    {
        const { start, object, factory, baseCall } = shape;
        const edits = [];
        if(shape.constructorNode)
        {
            edits.push({ start: start + shape.constructorNode.key.start, end: start + shape.constructorNode.key.end, text: declaration.name });
        }

        if(shape.rootFactory)
        {
            edits.push(...shape.initializationEdits);
            edits.push({ start: start + factory.key.start, end: start + factory.key.end, text: declaration.name });
        }
        else if(factory)
        {
            const parameters = source.slice(start + factory.key.end, start + factory.body.start).trim();
            const callTail = source.slice(start + baseCall.callee.end, start + baseCall.end);
            const open = maskCode(callTail).indexOf('(');
            const argumentsText = callTail.slice(open + 1, -1);
            edits.push({ start: start + factory.start, end: start + factory.end,
                text: `${declaration.name}${parameters} : base(${argumentsText}) {}` });
            const factorySignature = declaration.methodTypedParams?.find(group => group.name === 'create');
            if(factorySignature?.returnTypeName)
            {
                edits.push({ start: declaration.initializerStart + factorySignature.returnTypeStart,
                    end: declaration.initializerStart + factorySignature.returnTypeEnd, text: '' });
            }
        }

        for(const method of object.properties)
        {
            if(shape.overrides?.includes(method.key.name))
            {
                const member = declaration.classMembers?.find(candidate => candidate.name === method.key.name);
                const signature = declaration.methodTypedParams?.find(group => group.name === method.key.name);
                const offset = member?.start ?? declaration.initializerStart + (signature?.methodStart ?? method.start);
                if(!member?.override)
                {
                    edits.push({ start: offset, end: offset, text: 'override ' });
                }
            }

            if(!declaration.kind)
            {
                const tail = maskCode(source.slice(start + method.end, declaration.initializerEnd));
                const comma = (/^\s*,/).exec(tail);
                if(comma)
                {
                    const offset = start + method.end + comma[0].length - 1;
                    edits.push({ start: offset, end: offset + 1, text: '' });
                }
            }
        }

        let body = source.slice(declaration.initializerStart, declaration.initializerEnd);
        for(const edit of edits.sort((left, right) => right.start - left.start))
        {
            body = body.slice(0, edit.start - declaration.initializerStart) + edit.text + body.slice(edit.end - declaration.initializerStart);
        }

        const comment = declaration.jsdoc || '';
        const tags = LgdObjectInheritance.tags(declaration);
        const cleaned = LgdDocComment.removeTags(comment, tags);
        const gap = source.slice(declaration.start + comment.length, declaration.headStart);
        const docs = LgdDocComment.hasContent(cleaned) ? cleaned + gap : '';
        if(declaration.kind === 'class')
        {
            const head = source.slice(declaration.headStart, declaration.initializerStart);
            const relativeNameEnd = declaration.nameEnd - declaration.headStart;
            const keepHead = declaration.baseName || shape.rootFactory;
            const inheritedHead = keepHead ? head : `${head.slice(0, relativeNameEnd)} : ${shape.baseName}${head.slice(relativeNameEnd)}`;
            return `${docs}${inheritedHead}${body}`;
        }

        const exported = declaration.exported ? 'export ' : '';
        return `${docs}${declaration.indent}${exported}class ${declaration.name} : ${shape.baseName}${body}`;
    }

    /** @description Suppresses proposals introducing errors while allowing unrelated existing diagnostics to remain. */
    _validErrors(original, preview, declaration, delta)
    {
        const legacyWarnings = original.filter(error => error.severity === 'warning');
        const converted = preview.declarations.find(candidate =>
        {
            const namedClass = candidate.kind === 'class' && candidate.name === declaration.name;
            return namedClass && candidate.start >= declaration.start && candidate.end <= declaration.end + delta;
        });

        return preview.errors.every(error =>
        {
            const docWarning = error.code === 'lgd.jsdoc.returnType' && error.severity === 'warning' && error.quickFix?.kind === 'removeReturnDocType';
            const constructorDoc = docWarning && error.quickFix.declarationStart === converted?.headStart && error.quickFix.memberStart === converted?.constructorMember?.start;
            if(constructorDoc)
            {
                return true;
            }

            if(error.severity === 'warning')
            {
                const index = legacyWarnings.findIndex(previous => previous.code === error.code && previous.message === error.message);
                if(index === -1)
                {
                    return false;
                }

                legacyWarnings.splice(index, 1);
                return true;
            }

            return original.some(previous =>
            {
                if(previous.offset >= declaration.start && previous.offset < declaration.end)
                {
                    return false;
                }

                const offset = previous.offset >= declaration.end ? previous.offset + delta : previous.offset;
                return error.offset === offset && error.code === previous.code && error.message === previous.message;
            });
        });
    }
}

module.exports = ConvertObjectInheritanceFix;
