const JsBackend = require('./JsBackend');
const TsBackend = require('./TsBackend');
const CSharpBackend = require('./CSharpBackend');
const LgdTypeChecker = require('./LgdTypeChecker');
const { parseTypedParams, parseObjectMethodParams, splitTopLevelChunks } = require('./LgdTypedParams');

/** @description Matches a declaration type name: Number, a declared name (GoToNextParagraph), or a dotted type (vscode.Command); the final segment must be capitalized. */
const typeNamePattern = String.raw`(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*`;

/** @description Matches the head of a typed declaration, from the line start through the '='. */
const declarationHeadPattern = new RegExp(`^(?<indent>[\\t ]*)(?<exportKeyword>export[\\t ]+)?(?<readonlyKeyword>readonly[\\t ]+)?(?<typeName>${typeNamePattern})[\\t ]+(?<variableName>[$A-Z_a-z][\\w$]*)[\\t ]*=`, 'gm');

/** @description Matches malformed declaration heads: lines starting with a type name that never parsed as a declaration. */
const typeNameLinePattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?(?:readonly[\\t ]+)?(?<typeName>${typeNamePattern})(?![\\w$.])(?![\\t ]*\\()`, 'gm');

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
     * @returns {LgdCompileResultType} the compiled code, source mappings, declarations, and errors.
     */
    compileToJs(content, externals = new Map())
    {
        const parsed = this.parse(content, externals);
        const newline = this.detectNewline(content);
        const emitted = this.emitRange(content, JsBackend.create(newline), this.fullRange(content, parsed.declarations));
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
        const newline = this.detectNewline(content);
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
     * @returns {LgdParseResultType} the root declarations, the flat declaration list, and any errors.
     */
    parse(content, externals = new Map())
    {
        const found = [];
        const errors = [];
        const failedHeadStarts = [];
        declarationHeadPattern.lastIndex = 0;
        let headMatch = declarationHeadPattern.exec(content);
        while(headMatch)
        {
            const head = headMatch.groups;
            const headStart = headMatch.index;
            const headEnd = headStart + headMatch[0].length;
            const jsdoc = this.findPrecedingJsdoc(content, headStart);
            const scan = this.scanInitializer(content, headEnd);
            if(scan.error)
            {
                errors.push(this.createError(content, headStart, scan.error));
                failedHeadStarts.push(headStart);
                headMatch = declarationHeadPattern.exec(content);
                continue;
            }

            const initializerText = content.slice(headEnd, scan.end);
            if((/^\s*=/).test(initializerText))
            {
                errors.push(this.createError(content, headStart, 'Unexpected "=" in typed declaration.'));
                failedHeadStarts.push(headStart);
                headMatch = declarationHeadPattern.exec(content);
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
            const typeStart = headStart + head.indent.length + (head.exportKeyword || '').length + (head.readonlyKeyword || '').length;
            const typeEnd = typeStart + head.typeName.length;

            found.push({
                typeName: head.typeName,
                typeStart: typeStart,
                typeEnd: typeEnd,
                name: head.variableName,
                nameStart: nameStart,
                nameEnd: nameEnd,
                readonly: Boolean(head.readonlyKeyword),
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
            headMatch = declarationHeadPattern.exec(content);
        }

        this.collectMalformedErrors(content, found, failedHeadStarts, errors);

        for(const typeError of LgdTypeChecker.checkTypes(content, found, externals))
        {
            errors.push(this.createError(content, typeError.offset, typeError.message));
        }

        const declarations = this.buildTree(found);
        return { declarations: declarations, allDeclarations: found, errors: errors };
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

            if(!covered && !alreadyFailed)
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
                else if(character === '\n' && depth === 0 && this.nextLineStartsDeclaration(content, index + 1))
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
     * @description Checks whether the next line starts a new typed declaration, signalling a missing semicolon.
     * @param {string} content the LGD source text.
     * @param {number} from the offset where the next line starts.
     * @returns {boolean} true when the next line starts a declaration head.
     */
    nextLineStartsDeclaration(content, from)
    {
        const pattern = new RegExp(`^\\s*(?:export[\\t ]+)?(?:readonly[\\t ]+)?${typeNamePattern}[\\t ]+[$A-Z_a-z][\\w$]*[\\t ]*=`);
        return pattern.test(content.slice(from));
    },

    /**
     * @description Creates a parse error with a 1-based line number.
     * @param {string} content the LGD source text.
     * @param {number} offset the error offset.
     * @param {string} message the error message.
     * @returns {Object} the error.
     */
    createError(content, offset, message)
    {
        const line = content.slice(0, offset).split('\n').length;
        return { message: message, line: line, offset: offset };
    }
};

module.exports = LgdCompiler;
