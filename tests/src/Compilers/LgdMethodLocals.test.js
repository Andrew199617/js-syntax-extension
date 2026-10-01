const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

describe('LGD method-local typed declarations.', () =>
{
    function compile(source)
    {
        return LgdCompiler.create().compileToJs(source);
    }

    test('Resolves an assignment to the nearest preceding declaration when a name is redeclared.', () =>
    {
        const source = [
            'Object widget = {',
            '    findNext: function() {',
            '        Number index = 0;',
            '        index = 1;',
            '    },',
            '    findPrevious: function() {',
            '        readonly Number index = 2;',
            '    }',
            '};'
        ].join('\n');
        expect(compile(source).errors).toEqual([]);
    });

    test('Ignores an unrelated block when resolving the visible declaration.', () =>
    {
        const source = [
            'Object widget = {',
            '    run: function() {',
            '        Number index = 0;',
            '        {',
            '            Number other = index;',
            '        }',
            '        readonly Number index2 = 1;',
            '        index = 2;',
            '    }',
            '};'
        ].join('\n');
        expect(compile(source).errors).toEqual([]);
    });

    test('Rejects an assignment to a readonly local shadowed by a later mutable declaration.', () =>
    {
        const source = [
            'Object widget = {',
            '    run: function() {',
            '        readonly Number index = 0;',
            '        index = 1;',
            '    },',
            '    walk: function() {',
            '        Number index = 2;',
            '    }',
            '};'
        ].join('\n');
        const result = compile(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign to readonly variable \'index\'.');
    });

    test('Strips method parameter types at the right offset when earlier methods have typed locals.', () =>
    {
        const source = [
            'Object o = {',
            '  first() {',
            '    readonly Number count = 1;',
            '    return count;',
            '  },',
            '  second(Number value) {',
            '    return value;',
            '  }',
            '};'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('second(value) {');
        expect(result.code).toContain('/** @type {number} */\n    const count = 1;');
    });
});
