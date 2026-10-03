const LgdAccessibility = require('./LgdAccessibility');
const LgdEnumSyntax = require('./LgdEnumSyntax');
const JsBackend = require('./JsBackend');
const TsBackend = require('./TsBackend');
const CSharpBackend = require('./CSharpBackend');
const LgdTypeChecker = require('./LgdTypeChecker');
const LgdAssignmentChecker = require('./LgdAssignmentChecker');
const LgdClassMemberSemantics = require('./LgdClassMemberSemantics');
const LgdSourceMap = require('./LgdSourceMap');
const LgdObjectInheritance = require('./LgdObjectInheritance');
const LgdClassSyntax = require('./LgdClassSyntax');
const LgdBaseChecker = require('./LgdBaseChecker');
const LgdOverrideChecker = require('./LgdOverrideChecker');
const LgdContractChecker = require('./LgdContractChecker');
const LgdNativeClassEmitter = require('./LgdNativeClassEmitter');
const LgdOutputOptions = require('./LgdOutputOptions');
const LgdInterfaceErasure = require('./LgdInterfaceErasure');
const LgdInterfaceTypes = require('./LgdInterfaceTypes');
const LgdReturnChecker = require('./LgdReturnChecker');
const LgdReturnDocChecker = require('./LgdReturnDocChecker');
const LgdConstructorReturnChecker = require('./LgdConstructorReturnChecker');
const LgdVirtualDocChecker = require('./LgdVirtualDocChecker');
const LgdStandaloneReturnChecker = require('./LgdStandaloneReturnChecker');
const LgdBaseCalls = require('./LgdBaseCalls');
const LgdGeneratedJsValidator = require('./LgdGeneratedJsValidator');
const { parseTypedParams, parseObjectMethodParams, parseMethodHead, splitTopLevelChunks, isRegexStart, skipRegexLiteral } = require('./LgdTypedParams');
const { maskCode } = require('./LgdInfer');

const LgdVariableSyntax = require('./LgdVariableSyntax');

/** @description Shared annotated-variable patterns retain their own scanning positions. */
const { declarationHeadPattern, typeNameLinePattern } = LgdVariableSyntax;

/** @description Length of the JSDoc opening marker. */
const jsdocOpenLength = 3;

/** @description Length of the JSDoc closing marker. */
const jsdocCloseLength = 2;

/**
 * @description Parses LGD typed declarations and compiles them to JavaScript, TypeScript, or C#.
 * @type {LgdCompilerType}
 */
const LgdCompiler = {
    /**
     * @description Creates a compiler instance.
     * @returns {LgdCompilerType}
     */
    create()
    {
        return Object.create(LgdCompiler);
    },

    /**
     * @description Compiles LGD source to JavaScript.
     * @param {string} content the LGD source text.
     * @param {Map} externals require specs to {exportName, keyword} entries for cross-file typing.
     * @param {Object} options JavaScript output target and object model options.
     * @returns {LgdCompileResultType} the compiled code, source mappings, declarations, and errors.
     */
    compileToJs(content, externals = new Map(), options = {})
    {
        const resolved = LgdOutputOptions.resolve(options);
        const parsed = this.parse(content, externals, { ...options, deferAnalysis: true });
        for(const error of resolved.errors)
        {
            parsed.errors.push({ ...this.createError(content, 0, error.message), ...error });
        }

        const newline = this.detectNewline(content);
        const backend = JsBackend.create(newline);
        backend.objectModel = resolved.options.javascriptObjectModel;
        const output = this.emitRange(content, backend, this.fullRange(content, parsed.declarations));
        const members = LgdClassMemberSemantics.rewrite(output, content, parsed.allDeclarations, externals);
        const erased = LgdInterfaceErasure.apply(content, parsed.allDeclarations, externals, { ...members, projectId: parsed.projectId });
        this.appendTypeErrors(content, parsed.errors, erased.errors || []);
        const emitted = LgdInterfaceTypes.apply(content, parsed.allDeclarations, externals, erased);
        const validation = LgdGeneratedJsValidator.validate(emitted, content);
        if(!parsed.errors.some(error => error.severity !== 'warning'))
        {
            for(const error of validation.errors)
            {
                const diagnostic = { ...this.createError(content, error.offset, error.message, error.endOffset), ...error };
                if(resolved.options.javascriptObjectModel === 'class')
                {
                    diagnostic.code = 'lgd.output.nativeSyntax';
                }

                parsed.errors.push(diagnostic);
            }
        }

        let context;
        if(validation.errors.length === 0 && parsed.analysis?.required)
        {
            context = this.checkEmittedTypes(content, parsed, emitted, { externals: externals, tree: validation.tree, inherited: parsed.analysis.inherited });
        }

        if(resolved.options.javascriptObjectModel === 'class')
        {
            const analysis = { emitted: emitted, tree: validation.tree || context?.tree };
            for(const error of LgdNativeClassEmitter.check(content, parsed.allDeclarations, externals, analysis))
            {
                parsed.errors.push({ ...this.createError(content, error.offset, error.message, error.endOffset), ...error });
            }
        }

        return { code: emitted.code, mappings: emitted.segments, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
    },

    /**
     * @description Compiles LGD source to TypeScript.
     * @param {string} content the LGD source text.
     * @param {Map} externals require specs to {exportName, keyword} entries for cross-file typing.
     * @returns {LgdCompileResultType} the compiled code, source mappings, declarations, and errors.
     */
    compileToTs(content, externals = new Map())
    {
        const parsed = this.parse(content, externals);
        this.checkMemberTarget(content, parsed);
        const newline = this.detectNewline(content);
        const emitted = this.emitRange(content, TsBackend.create(newline), this.fullRange(content, parsed.declarations));
        return { code: emitted.code, mappings: emitted.segments, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
    },

    /**
     * @description Compiles LGD source to C#.
     * @param {string} content the LGD source text.
     * @param {Map} externals require specs to {exportName, keyword} entries for cross-file typing.
     * @returns {LgdCompileResultType} the compiled code, source mappings, declarations, and errors.
     */
    compileToCSharp(content, externals = new Map())
    {
        const parsed = this.parse(content, externals);
        this.checkMemberTarget(content, parsed);
        const newline = this.detectNewline(content);
        for(const declaration of parsed.allDeclarations.filter(candidate => candidate.kind === 'enum'))
        {
            parsed.errors.push(this.createError(content, declaration.typeStart, 'LGD enum emission is not supported by the experimental C# backend. String-valued enums are not C# enums.'));
        }

        const emitted = this.emitRange(content, CSharpBackend.create(newline), this.fullRange(content, parsed.declarations));
        const body = emitted.code;
        const header = `// Generated from an LGD source file by the LGD compiler (C# backend v0.2.0).${newline}`
            + `// v1 mock: typed declarations are translated to C#. Other statements pass${newline}`
            + `// through with light rewrites (.push -> .Add, === -> ==, = [] -> new List).${newline}`
            + `// export modifiers are dropped: this file uses top-level statements.${newline}`
            + `using System;${newline}`
            + `using System.Collections.Generic;${newline}`;
        const mappings = emitted.segments.map(segment => this.shiftSegment(segment, header.length));

        return { code: `${header}${body}`, mappings: mappings, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
    },

    checkMemberTarget(content, parsed) { LgdOutputOptions.checkMemberTarget(this, content, parsed); },

    /**
     * @description Detects the dominant line ending of the source so emitted code matches it.
     * @param {string} content the LGD source text.
     * @returns {string} the detected line ending.
     */
    detectNewline(content)
    {
        return content.includes('\r\n') ? '\r\n' : '\n';
    },

    /**
     * @description Parses typed declarations out of LGD source, building a containment tree for nested declarations.
     * @param {string} content the LGD source text.
     * @param {Map} externals require specs to {exportName, keyword} entries for cross-file typing.
     * @param {Object} options defers shared assignment and return analysis until final JavaScript emission.
     * @returns {LgdParseResultType} the root declarations, the flat declaration list, and any errors.
     */
    parse(content, externals = new Map(), options = {})
    {
        options = { ...externals.sourceContext, ...options };
        const classes = LgdClassSyntax.parse(content, this);
        const enums = LgdEnumSyntax.parse(content, this);
        const found = [ ...classes.declarations, ...enums.declarations ];
        const errors = [ ...classes.errors, ...enums.errors ];
        const masked = maskCode(content, true);
        const failedHeadStarts = [];
        declarationHeadPattern.lastIndex = 0;
        let headMatch = declarationHeadPattern.exec(masked);
        while(headMatch)
        {
            const head = headMatch.groups;
            const headStart = headMatch.index;
            const headEnd = headStart + headMatch[0].length;
            if(LgdVariableSyntax.isClassMemberHead(masked, classes.declarations, headStart, headEnd))
            {
                headMatch = declarationHeadPattern.exec(masked);
                continue;
            }

            const jsdoc = this.findPrecedingJsdoc(content, headStart);
            const scan = this.scanInitializer(content, headEnd);
            if(scan.error)
            {
                errors.push(this.createError(content, headStart, scan.error));
                failedHeadStarts.push(headStart);
                headMatch = declarationHeadPattern.exec(masked);
                continue;
            }

            const initializerText = content.slice(headEnd, scan.end);
            if((/^\s*=/).test(initializerText))
            {
                errors.push(this.createError(content, headStart, 'Unexpected "=" in typed declaration.'));
                failedHeadStarts.push(headStart);
                headMatch = declarationHeadPattern.exec(masked);
                continue;
            }

            // The head match ends with the '=', so walk back over trailing
            // whitespace to find the variable name span.
            let nameEnd = headEnd - 1;
            while(nameEnd > headStart && (content[nameEnd - 1] === ' ' || content[nameEnd - 1] === '\t'))
            {
                nameEnd--;
            }

            const nameStart = nameEnd - head.variableName.length;
            const typeStart = headStart + head.indent.length + (head.exportKeyword || '').length + (head.bindingKeyword || '').length;
            const typeEnd = typeStart + head.typeName.length;

            found.push({
                typeName: head.typeName,
                typeStart: typeStart,
                typeEnd: typeEnd,
                name: head.variableName,
                nameStart: nameStart,
                nameEnd: nameEnd,
                readonly: Boolean(head.bindingKeyword),
                bindingKind: head.bindingKeyword?.trim() || 'let',
                bindingStart: headStart + head.indent.length + (head.exportKeyword || '').length,
                bindingEnd: typeStart,
                exported: Boolean(head.exportKeyword),
                indent: head.indent,
                jsdoc: jsdoc ? jsdoc.text : null,
                start: jsdoc ? jsdoc.start : headStart,
                headStart: headStart,
                initializerStart: headEnd,
                initializerEnd: scan.end,
                end: scan.end + 1,
                initializerText: initializerText,
                members: this.extractMembers(initializerText),
                typedParams: parseTypedParams(initializerText),
                methodTypedParams: parseObjectMethodParams(initializerText),
                children: []
            });
            headMatch = declarationHeadPattern.exec(masked);
        }

        errors.push(...LgdVariableSyntax.checkLegacy(content, found, this));

        found.sort((first, second) => first.headStart - second.headStart);
        this.collectMalformedErrors(masked, found, failedHeadStarts, errors);

        const registry = LgdClassMemberSemantics.create({ content: content, declarations: found, externals: externals });
        this.appendTypeErrors(content, errors, LgdAccessibility.prepareDeclarations(registry, options));

        for(const inheritanceError of LgdObjectInheritance.check(found))
        {
            errors.push({ ...this.createError(content, inheritanceError.offset, inheritanceError.message, inheritanceError.endOffset), ...inheritanceError });
        }

        for(const contractError of LgdContractChecker.classify(content, found, externals))
        {
            errors.push({
                ...this.createError(content, contractError.offset, contractError.message, contractError.endOffset),
                ...contractError
            });
        }

        for(const memberError of LgdClassMemberSemantics.checkDeclarations(content, found, externals))
        {
            errors.push({ ...this.createError(content, memberError.offset, memberError.message, memberError.endOffset), ...memberError });
        }

        for(const typeError of LgdTypeChecker.checkTypes(content, found, externals))
        {
            errors.push(this.createError(content, typeError.offset, typeError.message));
        }

        for(const baseError of LgdBaseChecker.check(content, found, externals))
        {
            errors.push({
                ...this.createError(content, baseError.offset, baseError.message, baseError.endOffset),
                ...baseError
            });
        }

        for(const overrideError of LgdOverrideChecker.check(content, found, externals))
        {
            errors.push({
                ...this.createError(content, overrideError.offset, overrideError.message, overrideError.endOffset),
                ...overrideError
            });
        }

        for(const contractError of LgdContractChecker.check(content, found, externals))
        {
            if(contractError.code === 'lgd.contract.unknownType')
            {
                const duplicate = errors.findIndex(error => error.offset === contractError.offset && error.message.startsWith('Unknown type '));
                if(duplicate !== -1)
                {
                    errors.splice(duplicate, 1);
                }
            }

            errors.push({
                ...this.createError(content, contractError.offset, contractError.message, contractError.endOffset),
                ...contractError
            });
        }

        for(const warning of LgdReturnDocChecker.check(content, found))
        {
            errors.push({ ...this.createError(content, warning.offset, warning.message, warning.endOffset), ...warning });
        }

        for(const warning of LgdVirtualDocChecker.check(content, found))
        {
            errors.push({ ...this.createError(content, warning.offset, warning.message, warning.endOffset), ...warning });
        }

        const inheritedReturnSignatures = LgdContractChecker.bodySignatures(content, found, externals);
        const declarations = this.buildTree(found);
        const hasBaseCalls = LgdBaseCalls.hasCalls(content, found);
        const standaloneCandidates = LgdStandaloneReturnChecker.hasCandidates(content);
        const constructorReturns = LgdConstructorReturnChecker.hasCandidates(content, found);
        const parsed = { declarations: declarations, allDeclarations: found, errors: errors, projectId: options.projectId || null };
        const importedEnums = [...externals.values()].some(entry => entry.kind === 'enum');
        const hasConstBindings = (/\bconst\s+(?:[$A-Z_a-z]|[[{])/).test(masked);
        const required = found.length > 0 || hasBaseCalls || standaloneCandidates || importedEnums || hasConstBindings || externals.size > 0;
        if(options.deferAnalysis)
        {
            parsed.analysis = { inherited: inheritedReturnSignatures, required: required };
        }

        if(required && (!options.deferAnalysis || hasBaseCalls || standaloneCandidates || constructorReturns))
        {
            const output = this.emitRange(content, JsBackend.create(this.detectNewline(content)), this.fullRange(content, declarations));
            const emitted = LgdClassMemberSemantics.rewrite(output, content, found, externals);
            const returnErrors = constructorReturns ? LgdConstructorReturnChecker.check(content, found, emitted) : [];
            this.appendTypeErrors(content, errors, returnErrors);
            const standaloneErrors = LgdStandaloneReturnChecker.check(emitted);
            for(const standaloneError of standaloneErrors)
            {
                errors.push(this.createError(content, standaloneError.offset, standaloneError.message, standaloneError.endOffset));
            }

            if(hasBaseCalls)
            {
                for(const baseCallError of LgdBaseCalls.analyze(content, found, emitted, externals))
                {
                    errors.push(this.createError(content, baseCallError.offset, baseCallError.message, baseCallError.endOffset));
                }
            }

            if(standaloneErrors.length === 0 && !options.deferAnalysis)
            {
                this.checkEmittedTypes(content, parsed, emitted, { externals: externals, inherited: inheritedReturnSignatures });
            }
        }

        return parsed;
    },

    /** @description Checks mapped lexical assignments and returns, reusing a validated final-output syntax tree when available. */
    checkEmittedTypes(content, parsed, emitted, options)
    {
        let context;
        try
        {
            context = LgdReturnChecker.createContext(content, parsed.allDeclarations, emitted, { ...options, projectId: parsed.projectId });
        }
        catch(error)
        {
            const map = LgdSourceMap.create(emitted.segments);
            if(parsed.errors.length === 0)
            {
                parsed.errors.push(this.createError(content, map.toSource(error.pos || 0), `Cannot validate declared types: ${error.message}`));
            }
        }

        if(context)
        {
            const assignmentErrors = LgdAssignmentChecker.check(context);
            const memberErrors = context.members.check(context);
            const checked = [ ...LgdAccessibility.check(context), ...LgdEnumSyntax.check(context), ...assignmentErrors, ...memberErrors, ...LgdReturnChecker.check(context) ];
            this.appendTypeErrors(content, parsed.errors, checked);
        }

        return context;
    },

    /** @description Appends mapped lexical diagnostics while preserving earlier contract diagnostics. */
    appendTypeErrors(content, errors, checked)
    {
        for(const typeError of checked)
        {
            const duplicate = errors.some(error => error.offset === typeError.offset && error.message === typeError.message);
            if(!duplicate)
            {
                errors.push({ ...this.createError(content, typeError.offset, typeError.message, typeError.endOffset), category: 'type', ...typeError });
            }
        }
    },

    /**
     * @description Flags lines that start with a type keyword but did not parse as declarations.
     * @param {string} content the LGD source text.
     * @param {Array} found the parsed declarations.
     * @param {Array} failedHeadStarts head offsets that already produced an error.
     * @param {Array} errors the error list to append to.
     * @returns {void}
     */
    collectMalformedErrors(content, found, failedHeadStarts, errors)
    {
        typeNameLinePattern.lastIndex = 0;
        let lineMatch = typeNameLinePattern.exec(content);
        while(lineMatch)
        {
            if(LgdVariableSyntax.isInferredConst(content, lineMatch))
            {
                lineMatch = typeNameLinePattern.exec(content);
                continue;
            }

            let covered = false;
            for(const declaration of found)
            {
                if(lineMatch.index >= declaration.start && lineMatch.index < declaration.end)
                {
                    covered = true;
                    break;
                }
            }

            let alreadyFailed = false;
            for(const headStart of failedHeadStarts)
            {
                if(headStart === lineMatch.index)
                {
                    alreadyFailed = true;
                    break;
                }
            }

            const memberExpression = (/^[\t ]*[$A-Z_a-z][\w$]*\s*[.[]/).test(content.slice(lineMatch.index));
            if(!covered && !alreadyFailed && !memberExpression)
            {
                errors.push(this.createError(content, lineMatch.index, 'Invalid typed declaration.'));
            }

            lineMatch = typeNameLinePattern.exec(content);
        }
    },

    /**
     * @description Builds a containment tree so nested declarations compile inside their parents.
     * @param {Array} found the parsed declarations in document order.
     * @returns {Array} the root declarations.
     */
    buildTree(found)
    {
        const sorted = found.slice().sort((first, second) => first.start - second.start);
        const roots = [];
        const stack = [];
        for(const declaration of sorted)
        {
            while(stack.length > 0 && declaration.start >= stack[stack.length - 1].end)
            {
                stack.pop();
            }

            if(stack.length > 0)
            {
                stack[stack.length - 1].children.push(declaration);
            }
            else
            {
                roots.push(declaration);
            }

            stack.push(declaration);
        }

        return roots;
    },

    /**
     * @description Builds the root range covering a whole source file.
     * @param {string} content the LGD source text.
     * @param {Array} declarations the root declarations.
     * @returns {Object} the range.
     */
    fullRange(content, declarations)
    {
        return { start: 0, end: content.length, declarations: declarations };
    },

    /**
     * @description Emits compiled code for a source range, compiling nested declarations recursively.
     * Segments map source offsets to output offsets: gaps and separators are verbatim,
     * declaration heads are rewritten with an exact variable name span. Segments are exact
     * for backends that pass gaps and initializers through unchanged (JsBackend, TsBackend).
     * @param {string} content the LGD source text.
     * @param {Object} backend the target backend.
     * @param {Object} range the range to emit, with start, end, and declarations.
     * @returns {Object} the compiled code and its source mapping segments.
     */
    emitRange(content, backend, range)
    {
        let output = '';
        const segments = [];
        let cursor = range.start;
        for(const declaration of range.declarations)
        {
            const gap = backend.rewriteGap(content.slice(cursor, declaration.start));
            segments.push({
                srcStart: cursor,
                srcEnd: declaration.start,
                outStart: output.length,
                outEnd: output.length + gap.length,
                verbatim: true
            });
            output += gap;

            if(declaration.kind === 'enum')
            {
                const lowered = LgdEnumSyntax.emit(content, declaration, Object.getPrototypeOf(backend) === TsBackend);

                for(const segment of lowered.segments)
                {
                    segments.push(this.shiftSegment(segment, output.length));
                }

                output += lowered.code;
                cursor = declaration.end;
                continue;
            }

            if(declaration.kind === 'class' || declaration.kind === 'interface')
            {
                const emitter = backend.objectModel === 'class' ? LgdNativeClassEmitter : LgdClassSyntax;
                const lowered = emitter.emit(content, backend, declaration, this);
                for(const segment of lowered.segments)
                {
                    segments.push(this.shiftSegment(segment, output.length));
                }

                output += lowered.code;
                cursor = declaration.end;
                continue;
            }

            const head = backend.emitHead(declaration);
            segments.push({
                srcStart: declaration.start,
                srcEnd: declaration.initializerStart,
                outStart: output.length,
                outEnd: output.length + head.text.length,
                verbatim: false,
                nameSrcStart: declaration.nameStart,
                nameSrcEnd: declaration.nameEnd,
                nameOutStart: output.length + head.nameStart,
                nameOutEnd: output.length + head.nameEnd
            });
            output += head.text;

            const inner = this.emitRange(content, backend, {
                start: declaration.initializerStart,
                end: declaration.initializerEnd,
                declarations: declaration.children
            });
            const initializer = backend.rewriteInitializer(declaration, inner.code, inner.segments);
            for(const innerSegment of inner.segments)
            {
                segments.push(this.shiftSegment(innerSegment, output.length));
            }

            output += initializer;
            output += ';';
            segments.push({
                srcStart: declaration.end - 1,
                srcEnd: declaration.end,
                outStart: output.length - 1,
                outEnd: output.length,
                verbatim: true
            });
            cursor = declaration.end;
        }

        const tailGap = backend.rewriteGap(content.slice(cursor, range.end));
        segments.push({
            srcStart: cursor,
            srcEnd: range.end,
            outStart: output.length,
            outEnd: output.length + tailGap.length,
            verbatim: true
        });
        output += tailGap;
        return { code: output, segments: segments };
    },

    /**
     * @description Shifts a mapping segment's output offsets by a base amount, for nested or prefixed output.
     * @param {Object} segment the mapping segment.
     * @param {number} base the amount to shift output offsets by.
     * @returns {Object} a new segment with shifted output offsets.
     */
    shiftSegment(segment, base)
    {
        const shifted = {
            srcStart: segment.srcStart,
            srcEnd: segment.srcEnd,
            outStart: segment.outStart + base,
            outEnd: segment.outEnd + base,
            verbatim: segment.verbatim
        };
        if(segment.nameSrcStart !== undefined)
        {
            shifted.nameSrcStart = segment.nameSrcStart;
            shifted.nameSrcEnd = segment.nameSrcEnd;
            shifted.nameOutStart = segment.nameOutStart + base;
            shifted.nameOutEnd = segment.nameOutEnd + base;
        }

        return shifted;
    },

    /**
     * @description Finds a JSDoc block immediately preceding a declaration head.
     * @param {string} content the LGD source text.
     * @param {number} headStart the offset where the declaration head starts.
     * @returns {Object} the JSDoc span, or null.
     */
    findPrecedingJsdoc(content, headStart)
    {
        let index = headStart;
        while(index > 0 && (/\s/).test(content[index - 1]))
        {
            index--;
        }

        if(index < 2 || content[index - 2] !== '*' || content[index - 1] !== '/')
        {
            return null;
        }

        const commentEnd = index;
        const openIndex = content.lastIndexOf('/**', commentEnd - 2);
        if(openIndex === -1)
        {
            return null;
        }

        const inner = content.slice(openIndex + jsdocOpenLength, commentEnd - jsdocCloseLength);
        if(inner.includes('*/'))
        {
            return null;
        }

        return { start: openIndex, end: commentEnd, text: content.slice(openIndex, commentEnd) };
    },

    /**
     * @description Extracts the top-level member names of an object literal initializer, powering hover summaries and member completions.
     * Only a direct brace literal is read; anything else yields no members rather than a guess.
     * @param {string} initializerText the raw initializer text.
     * @returns {Array} the {name, kind} members, kind being 'method' or 'property'.
     */
    extractMembers(initializerText)
    {
        const text = initializerText.trim();
        if(text.length < 2 || text[0] !== '{' || text[text.length - 1] !== '}')
        {
            return [];
        }

        const members = [];
        for(const chunk of splitTopLevelChunks(text))
        {
            const member = this.parseMemberChunk(chunk.text.trim());
            if(member)
            {
                members.push(member);
            }
        }

        return members;
    },

    /**
     * @description Reads one top-level object literal member chunk into a {name, kind} record.
     * @param {string} chunk the trimmed member text.
     * @returns {Object|null} the member, or null for spreads, computed keys, and shorthand edge cases.
     */
    parseMemberChunk(chunk)
    {
        const text = chunk.replace(/^(?:\s|\/\*[\S\s]*?\*\/|\/\/[^\n]*)+/, '');
        if(text === '' || text.startsWith('...') || text[0] === '[')
        {
            return null;
        }

        const typedMethod = parseMethodHead(text);
        if(typedMethod && typedMethod.returnTypeName)
        {
            return { name: typedMethod.name, kind: 'method' };
        }

        const methodMatch = (/^(?:async\s+)?(?:get\s+|set\s+)?(?<name>[$A-Z_a-z][\w$]*|'[^\n']*'|"[^\n"]*")\s*\(/).exec(text);
        if(methodMatch)
        {
            return { name: this.unquoteName(methodMatch.groups.name), kind: 'method' };
        }

        const propertyMatch = (/^(?<name>[$A-Z_a-z][\w$]*|'[^\n']*'|"[^\n"]*")\s*:/).exec(text);
        if(propertyMatch)
        {
            return { name: this.unquoteName(propertyMatch.groups.name), kind: 'property' };
        }

        const shorthandMatch = (/^(?<name>[$A-Z_a-z][\w$]*)$/).exec(text);
        if(shorthandMatch)
        {
            return { name: shorthandMatch.groups.name, kind: 'property' };
        }

        return null;
    },

    /**
     * @description Strips surrounding quotes from an object literal member name.
     * @param {string} name the raw member name, possibly quoted.
     * @returns {string} the unquoted name.
     */
    unquoteName(name)
    {
        if(name.length >= 2 && (name[0] === "'" || name[0] === '"') && name[name.length - 1] === name[0])
        {
            return name.slice(1, -1);
        }

        return name;
    },


    /**
     * @description Scans an initializer for its terminating semicolon, tracking brackets, strings, and comments.
     * @param {string} content the LGD source text.
     * @param {number} from the offset just after the declaration '='.
     * @returns {Object} the terminator offset, or an error.
     */
    scanInitializer(content, from)
    {
        let depth = 0;
        let index = from;
        const modes = ['code'];
        const templateDepths = [];
        while(index < content.length)
        {
            const mode = modes[modes.length - 1];
            const character = content[index];
            const next = index + 1 < content.length ? content[index + 1] : '';
            if(mode === 'code')
            {
                if(character === "'" || character === '"' || character === '`')
                {
                    modes.push(character);
                }
                else if(character === '/' && next === '/')
                {
                    modes.push('line');
                    index++;
                }
                else if(character === '/' && next === '*')
                {
                    modes.push('block');
                    index++;
                }
                else if(character === '/' && isRegexStart(content, index))
                {
                    const regexEnd = skipRegexLiteral(content, index);
                    if(regexEnd !== -1)
                    {
                        index = regexEnd - 1;
                    }
                }
                else if(character === '(' || character === '[' || character === '{')
                {
                    depth++;
                }
                else if(character === ')' || character === ']' || character === '}')
                {
                    depth--;
                    if(depth < 0)
                    {
                        return { error: 'Unbalanced brackets in typed declaration.' };
                    }

                    if(templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth)
                    {
                        templateDepths.pop();
                        modes.pop();
                    }
                }
                else if(character === ';' && depth === 0)
                {
                    return { end: index };
                }
                else if(character === '\n' && depth === 0 && LgdVariableSyntax.nextLineStartsDeclaration(content, index + 1))
                {
                    return { error: 'Missing semicolon in typed declaration.' };
                }
            }
            else if(mode === "'" || mode === '"')
            {
                if(character === '\\')
                {
                    index++;
                }
                else if(character === mode)
                {
                    modes.pop();
                }
                else if(character === '\n')
                {
                    return { error: 'Unterminated string in typed declaration.' };
                }
            }
            else if(mode === '`')
            {
                if(character === '\\')
                {
                    index++;
                }
                else if(character === '`')
                {
                    modes.pop();
                }
                else if(character === '$' && next === '{')
                {
                    templateDepths.push(depth);
                    depth++;
                    modes.push('code');
                    index++;
                }
            }
            else if(mode === 'line')
            {
                if(character === '\n')
                {
                    modes.pop();
                }
            }
            else if(mode === 'block')
            {
                if(character === '*' && next === '/')
                {
                    modes.pop();
                    index++;
                }
            }

            index++;
        }

        return { error: 'Missing semicolon in typed declaration.' };
    },

    /**
     * @description Creates a parse error with a 1-based line number.
     * @param {string} content the LGD source text.
     * @param {number} offset the error offset.
     * @param {string} message the error message.
     * @param {number|null} endOffset the optional exclusive source end offset.
     * @returns {Object} the error.
     */
    createError(content, offset, message, endOffset = null)
    {
        const line = content.slice(0, offset).split('\n').length;
        const error = { message: message, line: line, offset: offset };
        if(Number.isInteger(endOffset))
        {
            error.endOffset = endOffset;
        }

        return error;
    }
};

module.exports = LgdCompiler;
