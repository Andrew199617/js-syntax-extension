const fs = require('fs');
const path = require('path');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Unmodified reported LGD source, including its invalid constructor spelling. */
let reportedSource;

beforeAll(async () =>
{
    reportedSource = await fs.promises.readFile(path.join(__dirname, '../../fixtures/object-inheritance.lgd'), 'utf8');
});

describe('LGD legacy object inheritance diagnostics.', () =>
{
    test.each([ 'oloo', 'class' ])('Diagnoses the reported annotation precisely without discarding the %s editor output.', javascriptObjectModel =>
    {
        const result = LgdCompiler.create().compileToJs(reportedSource, new Map(), { javascriptObjectModel: javascriptObjectModel });
        const inheritance = result.errors.find(error => error.code === 'lgd.object.inheritance');
        expect(inheritance).toMatchObject({ category: 'inheritance', quickFix: { kind: 'convertObjectInheritance', name: 'GoToAssignment', baseTypeName: 'BaseCommandType' } });
        expect(reportedSource.slice(inheritance.offset, inheritance.endOffset)).toBe('@extends {BaseCommandType}');
        expect(inheritance.message).toContain('class GoToAssignment : BaseClass');
        expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'Use GoToAssignment2(...) for the constructor.' })]));
        const map = LgdSourceMap.create(result.mappings);
        const offset = reportedSource.indexOf('assignmentIndex =');
        expect(result.code.slice(map.toOutput(offset))).toMatch(/^assignmentIndex =/);
        expect(result.code).toContain('let assignmentIndex =');
    });

    test.each([ '@extends {MissingType}', '@extends {ChildType}', '@extends', '@augments {BaseType}' ])('Reports unsupported or unresolved object inheritance: %s.', annotation =>
    {
        const source = `/** ${annotation} */\nconst Object Child = { read() { return 1; } };`;
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors.filter(error => error.code === 'lgd.object.inheritance')).toHaveLength(1);
    });

    test('Leaves module imports, LGD classes and comment-like strings alone.', () =>
    {
        const source = [
            '/** @extends {BaseType} */',
            'const Object Imported = require("./Base");',
            '/** @extends {BaseType} */',
            'class Base {}',
            'class Child : Base {}',
            'String text = "/** @extends {BaseType} */";'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(source).errors.filter(error => error.code === 'lgd.object.inheritance')).toEqual([]);
    });
});
