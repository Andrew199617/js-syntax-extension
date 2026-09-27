// Exercise extraction through the real parser and scope helpers.
const ExtractFunction = require('../../../src/Refactor/ExtractFunction');

// Mock only the editor API boundary.
const vscode = require('vscode');

// Parse the result to verify that edits produce valid JavaScript.
const parser = require('@babel/parser');

function createEditor(source, selectedText)
{
    const lines = source.split('\n');
    const start = source.indexOf(selectedText);
    const end = start + selectedText.length;
    const startLine = source.slice(0, start).split('\n').length - 1;
    const endLine = source.slice(0, end).split('\n').length - 1;
    const selection = {
        start: { line: startLine, character: start - source.lastIndexOf('\n', start - 1) - 1 },
        end: { line: endLine, character: end - source.lastIndexOf('\n', end - 1) - 1 }
    };
    const edits = [];
    function offsetAt(position)
    {
        let offset = 0;
        for(let line = 0; line < position.line; line++)
        {
            offset += lines[line].length + 1;
        }

        return offset + position.character;
    }

    const editor = {
        selection: selection,
        document: {
            lineCount: lines.length,
            offsetAt: offsetAt,

            /** @description Returns either the selected text or the complete test document. */
            getText(range)
            {
                if(range)
                {
                    return selectedText;
                }

                return source;
            },

            /** @description Returns the requested line of the test document. */
            lineAt(line)
            {
                return { text: lines[line] };
            }
        },

        /** @description Collects edits through the simulated VS Code edit builder. */
        edit(callback)
        {
            const builder = {
                /** @description Records an insertion at the requested source position. */
                insert(position, text)
                {
                    const offset = offsetAt(position);
                    edits.push({ start: offset, end: offset, text: text });
                },

                /** @description Records replacement of the selected source range. */
                replace(range, text)
                {
                    expect(range).toBe(selection);
                    edits.push({ start: start, end: end, text: text });
                }
            };
            callback(builder);
            return Promise.resolve(true);
        }
    };

    return {
        editor: editor,
        edits: edits,

        /** @description Applies recorded edits from the end of the source backward. */
        applyEdits()
        {
            let result = source;
            for(const edit of edits.sort((left, right) => right.start - left.start))
            {
                result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
            }

            return result;
        }
    };
}

function checkClassScope(source, selectedText)
{
    const context = createEditor(source, selectedText);
    const extraction = ExtractFunction.create();
    return extraction.checkIfInsideClass(context.editor.document, context.editor.selection);
}

jest.mock('vscode', () => ({
    window: {},
    Position: jest.fn().mockImplementation((line, character) => ({ line: line, character: character }))
}));

beforeEach(() =>
{
    global.lgd = { configuration: { tabSize: 2 } };
});

test('extracts beside the enclosing function using real insertion and scope detection', () =>
{
    const source = 'function run(value) {\n  console.log(value);\n}\n';
    const context = createEditor(source, 'console.log(value);');
    vscode.window.activeTextEditor = context.editor;
    expect(ExtractFunction.create().executeCommand()).toBe(true);
    const result = context.applyEdits();
    const syntax = parser.parse(result);
    expect(syntax.program.body.map(statement => statement.id.name)).toEqual([ 'run', 'extractedFunction' ]);
    expect(syntax.program.body[0].body.body[0].expression.callee.name).toBe('extractedFunction');
    expect(syntax.program.body[1].params.map(parameter => parameter.name)).toEqual(['value']);
    expect(syntax.program.body[1].body.body[0].expression.callee.object.name).toBe('console');
    expect(result).toContain('extractedFunction(value);');
});

test('leaves the document unchanged when no insertion boundary exists', () =>
{
    const context = createEditor('console.log(value);\n', 'console.log(value);');
    vscode.window.activeTextEditor = context.editor;
    expect(ExtractFunction.create().executeCommand()).toBe(false);
    expect(context.edits).toEqual([]);
});

test('recognizes a class declared on the first line', () =>
{
    expect(checkClassScope('class Runner {\n  run() {\n    console.log(1);\n  }\n}\n', 'console.log(1);')).toBe(true);
});

test('does not treat a function after a class as a class member', () =>
{
    expect(checkClassScope('\nclass Runner {}\nfunction run() {\n  console.log(1);\n}\n', 'console.log(1);')).toBe(false);
});

test('ignores the word class in comments and strings', () =>
{
    const source = 'function run() {\n  // class is only prose\n  const label = "class";\n  console.log(label);\n}\n';
    expect(checkClassScope(source, 'console.log(label);')).toBe(false);
});
