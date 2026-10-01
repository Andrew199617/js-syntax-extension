const JsBackend = require('./JsBackend');
const TsBackend = require('./TsBackend');
const CSharpBackend = require('./CSharpBackend');

/** @description Matches the head of a typed declaration, from the line start through the '='. */
const declarationHeadPattern = /^(?<indent>[\t ]*)(?<exportKeyword>export[\t ]+)?(?<readonlyKeyword>readonly[\t ]+)?(?<typeKeyword>Number|String|Boolean|BigInt|Symbol|Object|Array|Function)[\t ]+(?<variableName>[$A-Z_a-z][\w$]*)[\t ]*=/gm;

/** @description Matches lines that start with a type keyword, used to flag malformed declarations. */
const typeKeywordLinePattern = /^[\t ]*(?:export[\t ]+)?(?:readonly[\t ]+)?(?<typeKeyword>Number|String|Boolean|BigInt|Symbol|Object|Array|Function)\b(?![\t ]*\()/gm;

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
     * @returns {LgdCompileResultType} the compiled code, declarations, and errors.
     */
    compileToJs(content)
    {
        const parsed = this.parse(content);
        const newline = this.detectNewline(content);
        const code = this.emitRange(content, JsBackend.create(newline), this.fullRange(content, parsed.declarations));
        return { code: code, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
    },

    /**
     * @description Compiles LGD source to TypeScript.
     * @param {string} content the LGD source text.
     * @returns {LgdCompileResultType} the compiled code, declarations, and errors.
     */
    compileToTs(content)
    {
        const parsed = this.parse(content);
        const newline = this.detectNewline(content);
        const code = this.emitRange(content, TsBackend.create(newline), this.fullRange(content, parsed.declarations));
        return { code: code, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
    },

    /**
     * @description Compiles LGD source to C#.
     * @param {string} content the LGD source text.
     * @returns {LgdCompileResultType} the compiled code, declarations, and errors.
     */
    compileToCSharp(content)
    {
        const parsed = this.parse(content);
        const newline = this.detectNewline(content);
        const body = this.emitRange(content, CSharpBackend.create(newline), this.fullRange(content, parsed.declarations));
        const header = `// Generated from an LGD source file by the LGD compiler (C# backend v0.2.0).${newline}`
            + `// v1 mock: typed declarations are translated to C#. Other statements pass${newline}`
            + `// through with light rewrites (.push -> .Add, === -> ==, = [] -> new List).${newline}`
            + `// export modifiers are dropped: this file uses top-level statements.${newline}`
            + `using System;${newline}`
            + `using System.Collections.Generic;${newline}`;

        return { code: `${header}${body}`, declarations: parsed.declarations, allDeclarations: parsed.allDeclarations, errors: parsed.errors };
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
     * @returns {LgdParseResultType} the root declarations, the flat declaration list, and any errors.
     */
    parse(content)
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

            found.push({
                typeKeyword: head.typeKeyword,
                name: head.variableName,
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
                children: []
            });
            headMatch = declarationHeadPattern.exec(content);
        }

        this.collectMalformedErrors(content, found, failedHeadStarts, errors);
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
        typeKeywordLinePattern.lastIndex = 0;
        let lineMatch = typeKeywordLinePattern.exec(content);
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

            lineMatch = typeKeywordLinePattern.exec(content);
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
     * @param {string} content the LGD source text.
     * @param {Object} backend the target backend.
     * @param {Object} range the range to emit, with start, end, and declarations.
     * @returns {string} the compiled code.
     */
    emitRange(content, backend, range)
    {
        let output = '';
        let cursor = range.start;
        for(const declaration of range.declarations)
        {
            output += backend.rewriteGap(content.slice(cursor, declaration.start));
            output += backend.emitHead(declaration);
            const compiledInitializer = this.emitRange(content, backend, {
                start: declaration.initializerStart,
                end: declaration.initializerEnd,
                declarations: declaration.children
            });
            output += backend.rewriteInitializer(declaration, compiledInitializer);
            output += ';';
            cursor = declaration.end;
        }

        output += backend.rewriteGap(content.slice(cursor, range.end));
        return output;
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
        return (/^\s*(?:export[\t ]+)?(?:readonly[\t ]+)?(?:Number|String|Boolean|BigInt|Symbol|Object|Array|Function)[\t ]+[$A-Z_a-z][\w$]*[\t ]*=/).test(content.slice(from));
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
