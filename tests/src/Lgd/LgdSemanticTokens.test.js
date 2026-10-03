const vscode = require('vscode');
const manifest = require('../../../package.json');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');
const LgdKeywordFamilies = require('../../../src/Lgd/LgdKeywordFamilies');

/** @description Keyword roles independently expected from the extension's semantic legend. */
const keywordTypes = [ 'keyword', 'lgdDeclarationKeyword', 'lgdModifierKeyword', 'lgdTypeKeyword', 'lgdExpressionKeyword' ];

/** @description Uri of the LGD document used across semantic token tests. */
const LGD_URI = 'file:///workspace/Typed.lgd';

/** @description LGD source with typed params and a JSDoc type tag. */
const LGD_TEXT = [
    'const Object Commands = {',
    '    findNextChar(vscode.TextDocument document, Number line) {',
    '        return line;',
    '    },',
    '    create() {',
    '        /** @type {vscode.Command} */',
    '        this.command = {};',
    '        return this;',
    '    }',
    '};',
    ''
].join('\n');

/**
 * @description Opens the typed fixture in a fresh language service.
 * @returns {Promise<object>} the service and document.
 */
async function openTypedDocument()
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument(LGD_URI, LGD_TEXT);
    await service.openDocument(document);

    return { service: service, document: document };
}

/**
 * @description Reads the token text for one pushed token.
 * @param {object} document the text document.
 * @param {object} token the pushed {range, tokenType} token.
 * @returns {string} the covered text.
 */
function tokenText(document, token)
{
    return document.getText(token.range);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
});

describe('LgdSemanticTokensProvider', () =>
{
    test('enables LGD semantic tokens by default while leaving theme colors unchanged', () =>
    {
        const defaults = manifest.contributes.configurationDefaults;
        expect(defaults['[lgd]']).toEqual({ 'editor.semanticHighlighting.enabled': true });
        expect(defaults['editor.semanticHighlighting.enabled']).toBeUndefined();
    });

    test('reports class tokens for typed parameter types.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = await provider.provideDocumentSemanticTokens(document);

        expect(tokens).not.toBeNull();
        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.TextDocument');
        expect(texts).toContain('Number');
        const types = tokens.pushed.filter(token => token.tokenType === 'class');
        expect(types.map(token => tokenText(document, token))).toContain('Number');
        const lineParameter = tokens.pushed.find(token => tokenText(document, token) === 'line');
        expect(lineParameter.tokenType).toBe('parameter');
    });

    test('reports a class token for the JSDoc @type tag.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = await provider.provideDocumentSemanticTokens(document);

        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.Command');
    });

    test('reports declared return types even when a method has no typed parameters', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Counter { Number count() { return 1; } void reset() {} }');
        await service.openDocument(document);
        const provider = LgdSemanticTokensProvider.create(service);
        const tokens = await provider.provideDocumentSemanticTokens(document);
        expect(tokens.pushed.map(token => tokenText(document, token))).toEqual([ 'class', 'Counter', 'Number', 'return', 'void' ]);
    });

    test('separates declaration, modifier, and void families from control flow', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Command { async void execute() {} void reset() {} }');
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'class', 'async', 'void', 'void' ]);
        expect(tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => token.tokenType))
            .toEqual([ 'lgdDeclarationKeyword', 'lgdModifierKeyword', 'lgdTypeKeyword', 'lgdTypeKeyword' ]);
        expect(tokens.pushed.filter(token => token.tokenType === 'class').map(token => tokenText(document, token))).toEqual(['Command']);
    });

    test('gives constructor and method parameter declarations and references the same role without leaking to properties or shadows', async () =>
    {
        const source = [
            'class Command {',
            '    Command(String commandName) {',
            '        this.commandName = commandName;',
            '        commandName = "next";',
            '        this.read = () => commandName;',
            '        this.text = "commandName"; // commandName stays a comment',
            '        { const commandName = "local"; console.log(commandName); }',
            '    }',
            '    void update(String commandName) { this.commandName = commandName; }',
            '}',
            'Command.'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const parameters = tokens.pushed.filter(token => token.tokenType === 'parameter');
        const offsets = parameters.map(token => document.offsetAt(token.range.start));
        const expectedOffsets = [
            source.indexOf('commandName)'),
            source.indexOf('= commandName;') + '= '.length,
            source.indexOf('commandName = "next"'),
            source.indexOf('=> commandName;') + '=> '.length,
            source.lastIndexOf('commandName)'),
            source.lastIndexOf('= commandName;') + '= '.length
        ];
        expect(offsets).toEqual(expectedOffsets);
        expect(parameters.every(token => tokenText(document, token) === 'commandName')).toBe(true);
    });

    test('retains parameter references at the generated base-call mapping boundary', async () =>
    {
        const source = 'class Base { Base(String commandName) {} }\nclass Derived : Base { Derived(String commandName) : base(commandName) {} }';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const parameters = tokens.pushed.filter(token => token.tokenType === 'parameter');
        const offsets = parameters.map(token => document.offsetAt(token.range.start));
        expect(offsets).toEqual(Array.from(source.matchAll(/commandName/g), match => match.index));
    });

    test('keeps native keyword coverage while separating declaration and modifier families', async () =>
    {
        const source = [
            'import fallback, { item as renamed } from "module";',
            'export const ready = true;',
            'export default async function run(items) {',
            '    let total = 0; var count = 0;',
            '    for (const item of items) { if(item) continue; else total++; }',
            '    for (const key in items) { break; }',
            '    while(total) { break; } do { count++; } while(false);',
            '    try { await fallback(); } catch(error) { debugger; } finally { delete items.value; }',
            '    switch(total) { case 0: return typeof total; default: throw new Error("stop"); }',
            '    return void total;',
            '}',
            'function* values() { yield 1; }',
            'const holder = { get value() { return this.current; }, set value(input) { this.current = input; } };',
            'const Native = class extends Error { static make() { return new this(); } constructor() { super(); } };',
            'if(holder instanceof Object) holder.value = 1;',
            'const target = function() { return new.target; };'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = new Set(tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token)));
        const expected = [ 'import',
            'as',
            'from',
            'export',
            'const',
            'default',
            'async',
            'function',
            'let',
            'var',
            'for',
            'of',
            'in',
            'if',
            'continue',
            'else',
            'break',
            'while',
            'do',
            'try',
            'await',
            'catch',
            'debugger',
            'finally',
            'delete',
            'switch',
            'case',
            'return',
            'typeof',
            'throw',
            'new',
            'void',
            'yield',
            'get',
            'set',
            'this',
            'class',
            'extends',
            'static',
            'super',
            'instanceof' ];
        expect([...keywords].sort()).toEqual(expected.sort());
        const declarations = tokens.pushed.filter(token => token.tokenType === 'lgdDeclarationKeyword');
        expect([...new Set(declarations.map(token => tokenText(document, token)))].sort()).toEqual([ 'class', 'const', 'function', 'let', 'var' ]);
        const modifiers = tokens.pushed.filter(token => token.tokenType === 'lgdModifierKeyword');
        expect([...new Set(modifiers.map(token => tokenText(document, token)))].sort()).toEqual([ 'async', 'extends', 'static' ]);
        const control = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(control).toEqual(expect.arrayContaining([ 'return', 'if', 'else', 'throw', 'void' ]));
        expect(tokens.pushed.some(token => token.tokenType === 'lgdTypeKeyword')).toBe(false);
    });

    test('gives this receivers in class and object methods the expression family', async () =>
    {
        const source = [
            'class Counter {',
            '    Counter() { this.current = 0; }',
            '    read() { if (this.current) return this.current; return this; }',
            '}',
            'const holder = {',
            '    read() { return this.current; },',
            '    update(value) { this.current = value; },',
            '    capture() { return () => this; }',
            '};'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const receivers = tokens.pushed.filter(token => tokenText(document, token) === 'this');
        expect(receivers.map(token => document.offsetAt(token.range.start)))
            .toEqual(Array.from(source.matchAll(/\bthis\b/g), match => match.index));
        expect(receivers.every(token => token.tokenType === 'lgdExpressionKeyword')).toBe(true);
        const controls = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(controls).toEqual([ 'if', 'return', 'return', 'return', 'return' ]);
    });

    test('gives new construction keywords the expression family without changing control flow', async () =>
    {
        const source = [
            'class Widget { Widget() {} }',
            'const first = new Widget();',
            'const second = new models.Widget();',
            'function create() { if (ready) return new Widget(); return new models.Widget(); }'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const constructors = tokens.pushed.filter(token => tokenText(document, token) === 'new');
        expect(constructors.map(token => document.offsetAt(token.range.start)))
            .toEqual(Array.from(source.matchAll(/\bnew\b/g), match => match.index));
        expect(constructors.every(token => token.tokenType === 'lgdExpressionKeyword')).toBe(true);
        const controls = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(controls).toEqual([ 'if', 'return', 'return' ]);
    });

    test.each([ 'with', 'assert' ])('recognizes the existing JavaScript import %s clause as contextual syntax', async keyword =>
    {
        const source = `import settings from "settings.json" ${keyword} { type: "json" };`;
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'import', 'from', keyword ]);
    });

    test('recognizes JavaScript resource declarations without classifying a same-name identifier', async () =>
    {
        const source = 'async function acquire() { await using resource = open(); }\nconst using = 1;';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'async', 'function', 'await', 'using', 'const' ]);
        expect(tokens.pushed.map(token => token.tokenType)).toEqual([ 'lgdModifierKeyword', 'lgdDeclarationKeyword', 'keyword', 'lgdDeclarationKeyword', 'lgdDeclarationKeyword' ]);
    });

    test('restores erased LGD declaration and method keywords from their parsed source spans', async () =>
    {
        const source = [
            'export const Number total = 1;',
            'class Base { Base(String name) {} virtual async void run(String name) { await Promise.resolve(); } }',
            'class Derived : Base {',
            '    Derived(String name) : base(name) {}',
            '    override async void run(String name) { await base.run(name); }',
            '}'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'export',
            'const',
            'class',
            'virtual',
            'async',
            'void',
            'await',
            'class',
            'base',
            'override',
            'async',
            'void',
            'await',
            'base' ]);
        const declarations = tokens.pushed.filter(token => token.tokenType === 'lgdDeclarationKeyword');
        expect(declarations.map(token => tokenText(document, token))).toEqual([ 'const', 'class', 'class' ]);
        const modifiers = tokens.pushed.filter(token => token.tokenType === 'lgdModifierKeyword');
        expect(modifiers.map(token => tokenText(document, token))).toEqual([ 'virtual', 'async', 'override', 'async' ]);
        const builtins = tokens.pushed.filter(token => token.tokenType === 'lgdTypeKeyword');
        expect(builtins.map(token => tokenText(document, token))).toEqual([ 'void', 'void' ]);
        const expressions = tokens.pushed.filter(token => token.tokenType === 'lgdExpressionKeyword');
        expect(expressions.map(token => tokenText(document, token))).toEqual([ 'base', 'base' ]);
    });

    test('keeps the screenshot constructor base initializer distinct from control flow', async () =>
    {
        const source = [
            'class BaseCommand { BaseCommand(String command, String title) {} virtual async executeCommand() {} }',
            '/** @description Command to go to the start of the assignment in the current line. */',
            'class GoToAssignment : BaseCommand {',
            '    /**',
            '     * @description Initialize an instance of GoToAssignment.',
            '     * @returns {GoToAssignmentType}',
            '     */',
            '    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") { }',
            '    async override executeCommand() {',
            '        readonly Object editor = vscode.window.activeTextEditor;',
            '        if (!editor) { return; }',
            '    }',
            '}'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([
            expect.objectContaining({ code: 'lgd.declaration.readonly', severity: 'warning' }),
            expect.objectContaining({ code: 'lgd.jsdoc.returnType', severity: 'warning' })
        ]);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const baseTokens = tokens.pushed.filter(token => tokenText(document, token) === 'base');
        expect(baseTokens).toHaveLength(1);
        expect(baseTokens[0].tokenType).toBe('lgdExpressionKeyword');
        expect(document.offsetAt(baseTokens[0].range.start)).toBe(source.indexOf('base('));
        const controls = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(controls).toEqual([ 'if', 'return' ]);
    });

    test('does not turn contextual identifiers, property names, literal values, or comment text into keywords', async () =>
    {
        const source = [
            'const words = { class: 1, new: 1, async: 1, await: 1, void: 1, return: 1, virtual: 1, override: 1, readonly: 1, public: 1, sealed: 1, static: 1, as: 1, this: 1 };',
            'const async = words.async, from = words.as, virtual = words.virtual;',
            'const base = { run() {}, base() {} }; base.run(); base.base();',
            'words.class; words.new; words.return; words.await; words.public; words.sealed; words.static; words.this; words . this;',
            'const methods = { async() {}, get() {}, set() {}, this() {}, new() {} }; methods.this(); methods.new();',
            'const text = "class virtual new async await void return base this";',
            'const template = `readonly override await base this new`; // class async return base this new',
            'const pattern = /class|return|await|base|this|new/; /* new */',
            'const literals = [true, false, null];'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => keywordTypes.includes(token.tokenType)).map(token => tokenText(document, token));
        expect(keywords.every(word => word === 'const')).toBe(true);
        expect(keywords).toHaveLength(source.split('const ').length - 1);
    });

    test('masks erased declaration prefix comments before assigning keyword families', () =>
    {
        const source = 'export /* readonly abstract */ const Number total = 1;';
        const spans = [];
        const declaration = { headStart: 0, typeStart: source.indexOf('Number'), kind: 'variable' };
        LgdSemanticTokensProvider.collectErasedKeywords(source, [declaration], spans);
        expect(spans.map(span => ({ text: source.slice(span.start, span.end), type: span.tokenType })))
            .toEqual([ { text: 'export', type: 'keyword' }, { text: 'const', type: 'lgdDeclarationKeyword' } ]);
    });

    test('registers family fallback scopes without forcing theme colors or keyword inheritance', () =>
    {
        const contribution = manifest.contributes.semanticTokenScopes.find(entry => entry.language === 'lgd');
        for(const family of Object.values(LgdKeywordFamilies.families))
        {
            expect(contribution.scopes[family.tokenType]).toEqual([family.scope]);
            expect(LgdSemanticTokensProvider.legend.tokenTypes).toContain(family.tokenType);
        }

        expect(manifest.contributes.semanticTokenTypes.map(entry => entry.id)).toEqual(keywordTypes.slice(1));
        expect(manifest.contributes.semanticTokenTypes.every(entry => entry.superType === undefined)).toBe(true);
        expect(manifest.contributes.configurationDefaults['editor.semanticTokenColorCustomizations']).toBeUndefined();
    });

    test('returns null when the document is not open.', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const provider = LgdSemanticTokensProvider.create(service);
        const document = makeTextDocument(LGD_URI, LGD_TEXT);

        expect(await provider.provideDocumentSemanticTokens(document)).toBeNull();
    });

    test('waits for the first compilation and retains constructor tokens when base arguments are invalid', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const source = 'class Base { Base(String title) {} }\nclass Derived : Base { Derived() : base(42) {} async void reset() {} }';
        const document = makeTextDocument(LGD_URI, source);
        document.version = 1;
        let release;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });
        vscode.workspace.openTextDocument.mockImplementationOnce(async options =>
        {
            await gate;
            return makeTextDocument('untitled:delayed-mirror', options.content);
        });

        const opening = service.openDocument(document);
        const requested = LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        expect(service.getState(document.uri).declarations).toEqual([]);
        release();
        const tokens = await requested;
        const state = await opening;
        expect(state.errors).toHaveLength(1);
        expect(source.slice(state.errors[0].offset, state.errors[0].endOffset)).toBe('42');
        const names = tokens.pushed.map(token => tokenText(document, token));
        expect(names.filter(name => name === 'Derived')).toHaveLength(2);
        expect(names).toContain('void');
        expect(tokens.pushed.find(token => tokenText(document, token) === 'base').tokenType).toBe('lgdExpressionKeyword');
    });

    test.each([ 'canceled', 'changed', 'closed' ])('discards a %s semantic request while compilation is pending', async reason =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Original { Original() {} }');
        document.version = 1;
        let release;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });
        service.collectExternalTypes = async () =>
        {
            await gate;
            return new Map();
        };

        const cancellation = { isCancellationRequested: false };
        const opening = service.openDocument(document);
        const requested = LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document, cancellation);
        if(reason === 'canceled')
        {
            cancellation.isCancellationRequested = true;
        }
        else if(reason === 'changed')
        {
            document.version++;
            document.setText('class Updated {}');
        }
        else
        {
            service.closeDocument(document);
        }

        release();
        expect(await requested).toBeNull();
        await opening;
    });

    test('does not reuse old tokens after a newer mirror update fails', async () =>
    {
        const { service, document } = await openTypedDocument();
        document.version = 1;
        await service.updateDocument(document);
        document.version++;
        document.setText('class Updated { Updated() {} }');
        vscode.workspace.applyEdit.mockResolvedValueOnce(false);
        await expect(service.updateDocument(document)).rejects.toThrow();
        const provider = LgdSemanticTokensProvider.create(service);
        expect(await provider.provideDocumentSemanticTokens(document)).toBeNull();
    });

    test('exposes class in the legend.', () =>
    {
        expect(LgdSemanticTokensProvider.legend.tokenTypes).toContain('class');
    });
});

test('semantic JSDoc types exclude comment-looking text inside strings and line comments', () =>
{
    const service = LgdLanguageService.create({}, () => undefined);
    const provider = LgdSemanticTokensProvider.create(service);
    const source = [
        'const text = "/** @type {FakeType} */";',
        '// /** @type {CommentedType} */',
        '/** @type {ActualType} */',
        'Object settings = {};'
    ].join('\n');

    expect(provider.collectTypeSpans(source, []).map(span => source.slice(span.start, span.end))).toEqual(['ActualType']);
});
