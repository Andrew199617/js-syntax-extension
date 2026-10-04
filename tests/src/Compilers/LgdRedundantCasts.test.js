const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const RemoveRedundantCastFix = require('../../../src/Lgd/QuickFixes/RemoveRedundantCastFix');
const createQuickFixRegistry = require('../../../src/Lgd/QuickFixes/QuickFixRegistry');
const LgdDiagnosticDefinitions = require('../../../src/Lgd/LgdDiagnosticDefinitions');

/** @description Checks source with the compiler's authoritative cast metadata. */
function redundant(source)
{
    return LgdCompiler.create().parse(source).errors.filter(error => error.code === 'lgd.cast.redundant');
}

beforeEach(() => Oloo.objectMap.clear());

describe('Guarded unnecessary reference cast removal.', () =>
{
    test.each([ 'oloo', 'class' ])('preserves identity, member grouping, and keyword separation in %s output', objectModel =>
    {
        const source = [
            'class Item { Number value = 3; }',
            'const Item original = Item.create();',
            'function read() { return(Item)original; }',
            'module.exports = [read() === original, ((Item)original).value];'
        ].join('\n');
        const errors = redundant(source);
        expect(errors).toHaveLength(2);
        let fixed = source;
        for(const error of errors.slice().reverse())
        {
            const proposal = new RemoveRedundantCastFix().createProposal({ source: { text: source }, state: { externals: new Map() }, snapshots: [] }, error.quickFix);
            expect(proposal).not.toBeNull();
            fixed = fixed.slice(0, proposal.offset) + proposal.newText + fixed.slice(proposal.endOffset);
        }

        expect(fixed).toContain('return original');
        expect(fixed).toContain('( original).value');
        const compiled = LgdCompiler.create().compileToJs(fixed, new Map(), { javascriptObjectModel: objectModel });
        expect(compiled.errors).toEqual([]);
        const context = { Oloo: Oloo, module: { exports: null } };
        virtualMachine.runInNewContext(compiled.code, context);
        const expectedValue = 3;
        expect(context.module.exports).toEqual([ true, expectedValue ]);
    });

    test.each([
        'const Number original = 1; const value = (Number)original;',
        'class Item {}\nlet Item original = Item.create();\nconst value = (Item)original;',
        'class Item {}\nconst Object original = Item.create();\nconst value = (Item)original;',
        'class Item {}\nconst Item original = Item.create();\nconst value = (Item?)original;',
        'class Item {}\nconst Item original = Item.create();\nconst value = (/* keep */ Item)original;',
        'class Base {}\nclass Derived : Base {}\nconst Derived original = Derived.create();\nconst value = (Base)original;',
        'class Base {}\nclass Derived : Base {}\nconst Base original = Derived.create();\nconst value = (Derived)original;',
        'class Item {}\nconst original = unknown();\nconst value = (Item)original;',
        'class Item {}\nconst Item original = "wrong";\nconst value = (Item)original;'
    ])('declines conversions, uncertain values, changed contracts, and commented heads: %s', source =>
    {
        expect(redundant(source)).toEqual([]);
    });

    test('declines imported types and revalidates a previously valid proposal against changed source', () =>
    {
        const source = 'class Item {}\nconst Item original = Item.create();\nconst value = (Item)original;';
        const error = redundant(source)[0];
        const changed = source.replace('const Item original', 'const Object original');
        const context = { source: { text: changed }, state: { externals: new Map() }, snapshots: [] };
        expect(new RemoveRedundantCastFix().createProposal(context, error.quickFix)).toBeNull();
        const imported = 'const Item = require("./Item.js");\nconst Item original = Item.create();\nconst value = (Item)original;';
        const descriptor = { exportName: 'Item', keyword: 'Object', kind: 'class', sourcePath: '/types/Item.lgd',
            constructorParams: [], methodsKnown: true, contractsKnown: true, methodSignatures: [], contractSignatures: [], members: [] };
        const checked = LgdCompiler.create().parse(imported, new Map([[ './Item.js', descriptor ]]));
        expect(checked.errors.some(candidate => candidate.code === 'lgd.cast.redundant')).toBe(false);
    });

    test('registers the style warning and explicit automatic-fix eligibility', () =>
    {
        const source = 'class Item {}\nconst Item original = Item.create();\nconst value = (Item)original;';
        const error = redundant(source)[0];
        expect(error.severity).toBe('warning');
        expect(LgdDiagnosticDefinitions.get(error).visibleCode).toBe('style');
        expect(LgdDiagnosticDefinitions.fixKinds(error)).toEqual(['removeRedundantCast']);
        const handler = createQuickFixRegistry().get('removeRedundantCast');
        expect(handler.ruleId).toBe('unnecessary-reference-cast');
        expect(handler.automatic).toBe(true);
    });
});
