const fs = require('fs');
const path = require('path');
const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Reproduces the external VS Code position value used by the screenshot example. */
function Position(line, character)
{
    this.line = line;
    this.character = character;
}

describe.each([ 'oloo', 'class' ])('The nullable findPreviousChar example with %s output.', objectModel =>
{
    test('Returns positions for both search paths and null when the character is absent.', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/nullable-position-search.lgd'), 'utf8');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@returns {vscode.Position | null}');
        const sandbox = { module: { exports: {} }, require: () => ({ Position: Position }) };
        virtualMachine.runInNewContext(result.code, sandbox);
        const search = sandbox.module.exports.create();
        const document = { lineAt: line => ({ text: [ 'a)b', 'xyz)' ][line] }) };
        const currentCharacter = 'xyz)'.length + 1;
        const matchCharacter = 'xyz)'.indexOf(')');
        expect(search.findPreviousChar(document, new Position(1, currentCharacter), ')')).toEqual(new Position(1, matchCharacter));
        expect(search.findPreviousChar(document, new Position(1, 1), ')')).toEqual(new Position(0, 1));
        expect(search.findPreviousChar(document, new Position(1, currentCharacter), '?')).toBeNull();
    });

    test('Keeps the original null-return error until the nullable suffix is present.', async () =>
    {
        const source = (await fs.promises.readFile(path.join(__dirname, '../../fixtures/nullable-position-search.lgd'), 'utf8'))
            .replace('vscode.Position? findPreviousChar', 'vscode.Position findPreviousChar');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([expect.objectContaining({
            code: 'lgd.return.typeMismatch',
            message: 'Cannot return null from a vscode.Position method.',
            offset: source.lastIndexOf('null'), endOffset: source.lastIndexOf('null') + 'null'.length
        })]);
    });
});
