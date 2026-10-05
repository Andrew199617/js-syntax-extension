const path = require('path');
const { pathToFileURL } = require('url');
const FakeMarkdownString = require('./fakeMarkdownString');

/**
 * @description Makes a fake vscode Position.
 * @param {number} line the line.
 * @param {number} character the character.
 * @returns {object} the position.
 */
function makePosition(line, character)
{
    return { line: line, character: character };
}

/**
 * @description Makes a fake vscode Range.
 * @param {object} start the start position.
 * @param {object} end the end position.
 * @returns {object} the range.
 */
function makeRange(start, end)
{
    return { start: start, end: end };
}

/**
 * @description Makes a fake vscode Location.
 * @param {object} uri the uri.
 * @param {object} range the range.
 * @returns {object} the location.
 */
function makeLocation(uri, range)
{
    return { uri: uri, range: range };
}

/**
 * @description Makes a fake vscode Hover.
 * @param {Array} contents the hover contents.
 * @param {object} range the hover range.
 * @returns {object} the hover.
 */
function makeHover(contents, range)
{
    return { contents: contents, range: range };
}

/**
 * @description Makes a fake vscode CompletionItem.
 * @param {string} label the item label.
 * @param {number} kind the item kind.
 * @returns {object} the completion item.
 */
function makeCompletionItem(label, kind)
{
    return { label: label, kind: kind };
}

/**
 * @description Makes a fake vscode Diagnostic.
 * @param {object} range the range.
 * @param {string} message the message.
 * @param {number} severity the severity.
 * @returns {object} the diagnostic.
 */
function makeDiagnostic(range, message, severity)
{
    return { range: range, message: message, severity: severity, source: undefined };
}

/**
 * @description Makes a fake vscode WorkspaceEdit that records replacements.
 * @returns {object} the edit.
 */
function makeWorkspaceEdit()
{
    const replacements = [];
    const edit = {
        replacements: replacements,

        /**
         * @description Records a text replacement.
         * @param {object} uri the document uri.
         * @param {object} range the range to replace.
         * @param {string} newText the replacement text.
         * @returns {void}
         */
        replace: (uri, range, newText) =>
        {
            replacements.push({ uri: uri, range: range, newText: newText });
        }
    };

    return edit;
}

/**
 * @description Builds a file URI with native filesystem paths and escaped URL characters.
 * @param {string} uriKey the file or untitled URI.
 * @returns {object} the URI.
 */
function makeUri(uriKey)
{
    if(!uriKey.startsWith('file://'))
    {
        return { scheme: 'untitled', toString: () => uriKey, fsPath: uriKey };
    }

    let filename = decodeURIComponent(uriKey.slice('file://'.length));
    if(process.platform === 'win32' && (/^\/[A-Za-z]:/).test(filename))
    {
        filename = filename.slice(1);
    }

    filename = path.resolve(filename);
    const serialized = pathToFileURL(filename).toString();
    return { scheme: 'file', toString: () => serialized, fsPath: filename };
}

/**
 * @description Makes a fake text document with working offset/position translation.
 * @param {string} uriKey the uri string.
 * @param {string} text the document text.
 * @returns {object} the fake document.
 */
function makeTextDocument(uriKey, text)
{
    let currentText = text;
    const document = {
        uri: makeUri(uriKey),
        isClosed: false,
        eol: text.includes('\r\n') ? 2 : 1,

        /**
         * @description Returns the document text, or the text inside a range.
         * @param {object} [range] the range to slice.
         * @returns {string} the text.
         */
        getText: range =>
        {
            if(!range)
            {
                return currentText;
            }

            return currentText.slice(document.offsetAt(range.start), document.offsetAt(range.end));
        },

        /**
         * @description Replaces the document text.
         * @param {string} newText the new text.
         * @returns {void}
         */
        setText: newText =>
        {
            currentText = newText;
        },

        /**
         * @description Converts a position to an offset.
         * @param {object} position the position.
         * @returns {number} the offset.
         */
        offsetAt: position =>
        {
            const lines = currentText.split('\n');
            let offset = 0;
            for(let index = 0; index < position.line; index += 1)
            {
                offset += lines[index].length + 1;
            }

            return offset + position.character;
        },

        /**
         * @description Converts an offset to a position.
         * @param {number} offset the offset.
         * @returns {object} the position.
         */
        positionAt: offset =>
        {
            const lines = currentText.split('\n');
            let remaining = offset;
            for(let index = 0; index < lines.length; index += 1)
            {
                if(remaining <= lines[index].length)
                {
                    return makePosition(index, remaining);
                }

                remaining -= lines[index].length + 1;
            }

            const last = lines.length - 1;

            return makePosition(last, lines[last].length);
        },

        /**
         * @description Returns the line range for a line number.
         * @param {number} line the line number.
         * @returns {object} the line range.
         */
        lineAt: line =>
        {
            const lines = currentText.split('\n');

            return { range: makeRange(makePosition(line, 0), makePosition(line, lines[line].length)) };
        },

        /**
         * @description Returns the word range at a position, using word characters.
         * @param {object} position the position.
         * @returns {object|undefined} the word range, or undefined when not on a word.
         */
        getWordRangeAtPosition: position =>
        {
            const lines = currentText.split('\n');
            const line = lines[position.line];
            if(line === undefined)
            {
                return;
            }

            function isWord(character)
            {
                return (/\w/).test(character);
            }

            if(!isWord(line[position.character]))
            {
                return;
            }

            let start = position.character;
            while(start > 0 && isWord(line[start - 1]))
            {
                start -= 1;
            }

            let end = position.character;
            while(end < line.length && isWord(line[end]))
            {
                end += 1;
            }

            return makeRange(makePosition(position.line, start), makePosition(position.line, end));
        }
    };

    return document;
}

/**
 * @description Makes a fake vscode SemanticTokensLegend.
 * @param {Array} tokenTypes the token types.
 * @param {Array} tokenModifiers the token modifiers.
 * @returns {object} the fake legend.
 */
function makeSemanticTokensLegend(tokenTypes, tokenModifiers)
{
    return { tokenTypes: tokenTypes, tokenModifiers: tokenModifiers };
}

/**
 * @description Makes a fake vscode SemanticTokensBuilder that records pushed tokens.
 * @returns {object} the fake builder.
 */
function makeSemanticTokensBuilder()
{
    const pushed = [];

    /**
     * @description Records one pushed token.
     * @param {object} range the token range.
     * @param {string} tokenType the token type.
     * @returns {void}
     */
    function pushToken(range, tokenType)
    {
        pushed.push({ range: range, tokenType: tokenType });
    }

    /**
     * @description Builds the fake token result.
     * @returns {object} the recorded tokens.
     */
    function buildTokens()
    {
        return { pushed: pushed };
    }

    return { pushed: pushed, push: pushToken, build: buildTokens };
}

/**
 * @description Shared vscode mock for LGD language service tests. Use with
 * `jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest))`.
 * @param {object} jestApi the jest api, for creating mock functions.
 * @returns {object} the fake vscode api.
 */
function createFakeVscode(jestApi)
{
    const registry = new Map();
    const api = {
        Uri: { file: filename => makeUri(`file://${filename}`) },
        Position: makePosition,
        Range: makeRange,
        Location: makeLocation,
        Hover: makeHover,
        MarkdownString: FakeMarkdownString,
        CompletionItem: makeCompletionItem,
        CompletionItemKind: { Method: 1, Property: 9, Class: 6, Interface: 7, Enum: 12, Keyword: 13, Module: 8, TypeParameter: 24 },
        Diagnostic: makeDiagnostic,
        WorkspaceEdit: makeWorkspaceEdit,
        EndOfLine: { CRLF: 2 },
        DiagnosticSeverity: { Error: 0, Warning: 1 },
        SemanticTokensLegend: makeSemanticTokensLegend,
        SemanticTokensBuilder: makeSemanticTokensBuilder,

        /** @description Clears the opened mirror documents. */
        __reset: () => registry.clear(),

        workspace: {
            openTextDocument: jestApi.fn(options =>
            {
                const key = `untitled:mirror-${registry.size}`;
                const document = makeTextDocument(key, options.content);
                document.languageId = options.language;
                registry.set(document.uri.toString(), document);

                return document;
            }),
            applyEdit: jestApi.fn(edit =>
            {
                for(const replacement of edit.replacements)
                {
                    const document = registry.get(replacement.uri.toString());
                    if(document?.isClosed)
                    {
                        return false;
                    }

                    if(document)
                    {
                        const start = document.offsetAt(replacement.range.start);
                        const end = document.offsetAt(replacement.range.end);
                        const text = document.getText();
                        const newline = document.eol === api.EndOfLine.CRLF ? '\r\n' : '\n';
                        const insertedText = replacement.newText.replace(/\r?\n/g, newline);
                        document.setText(text.slice(0, start) + insertedText + text.slice(end));
                    }
                }

                return true;
            })
        },
        commands: { executeCommand: jestApi.fn() },
        languages: {}
    };

    return api;
}

module.exports = { createFakeVscode: createFakeVscode, makeTextDocument: makeTextDocument };
