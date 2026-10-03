const fs = require('fs');
const path = require('path');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles cyclic lexical-value inference with either supported class output. */
function compile(source, objectModel)
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
}

describe.each([ 'oloo', 'class' ])('LGD expression inference cycles with %s output.', objectModel =>
{
    test('Compiles the complete BaseCommand reproduction without losing its methods.', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/basecommand.lgd'), 'utf8');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        const declaration = result.allDeclarations.find(candidate => candidate.name === 'BaseCommand');
        expect(declaration.classMembers.map(member => member.name)).toEqual([
            'BaseCommand', 'commandName', 'createCommand', 'executeCommand', 'findNextChar', 'findPreviousChar'
        ]);
        expect(result.code).toContain('document.lineAt(position.line).text');
        expect(result.code).toContain('textLine.lastIndexOf');
    });

    test.each([ 'document.text', 'document.lineAt(0).text', 'document?.text' ])('Stops cyclic loop origins for %s.', initializer =>
    {
        const source = `while(flag) {
            readonly String text = ${initializer};
        }`;
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain(initializer);
    });

    test('Retains an actionable independent mismatch after an unknown loop initializer.', () =>
    {
        const source = `while(flag) {
            readonly String text = document.text;
            Number count = "wrong";
        }`;
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([expect.objectContaining({
            code: 'lgd.assignment.typeMismatch',
            offset: source.indexOf('"wrong"'),
            endOffset: source.indexOf('"wrong"') + '"wrong"'.length
        })]);
    });

    test('Keeps unknown loop-origin returns conservative instead of trusting their annotation.', () =>
    {
        const source = `class Sample {
            Number read(Object document, Boolean ready) {
                while(ready) {
                    readonly String text = document.text;
                    if(ready) return text;
                }
                return 1;
            }
        }`;
        expect(compile(source, objectModel).errors).toEqual([]);
    });

    test('Preserves separately inferred return branches after cycle detection.', () =>
    {
        const source = `class Sample {
            Number read(Boolean ready) {
                let result = ready ? 1 : "wrong";
                return result;
            }
        }`;
        expect(compile(source, objectModel).errors).toEqual([expect.objectContaining({
            code: 'lgd.return.typeMismatch', message: 'Cannot return String from a Number method.'
        })]);
    });
});
