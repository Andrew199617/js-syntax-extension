const assert = require('assert').strict;
const fs = require('fs').promises;
const path = require('path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');
const LgdKeywordFamilies = require('../../src/Lgd/LgdKeywordFamilies');

// Repository root containing the syntax grammars.
const root = path.resolve(__dirname, '../..');

// The LGD language grammar under test.
const lgdScope = 'source.lgd';

// Scope the LGD grammar assigns to type keywords in declaration heads.
const typeScope = 'storage.type.lgd';

// Scope the LGD grammar assigns to declared variable names.
const nameScope = 'variable.other.definition.lgd';

// Scope the LGD grammar assigns to the readonly modifier.
const readonlyScope = LgdKeywordFamilies.families.modifier.scope;

// Scope the LGD grammar assigns to the export modifier.
const exportScope = 'keyword.control.lgd';

async function createRegistry()
{
    const grammarDirectory = process.env.VSCODE_JS_GRAMMAR_DIR || path.join(__dirname, 'fixtures');
    const wasm = await fs.readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const contribution = manifest.contributes.grammars.find(grammar => grammar.scopeName === lgdScope);
    assert.ok(contribution, 'LGD grammar is registered in the extension manifest');
    assert.strictEqual(contribution.language, 'lgd');
    const grammarPath = path.join(root, contribution.path);
    const grammar = textmate.parseRawGrammar(await fs.readFile(grammarPath, 'utf8'), grammarPath);
    const registryOptions = {
        onigLib: Promise.resolve({
            /** @description Creates the regex scanner used by the test grammar registry. */
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),

            /** @description Wraps a test string for Oniguruma tokenization. */
            createOnigString: value => new oniguruma.OnigString(value)
        }),

        /** @description Loads the LGD grammar or the JavaScript grammar it includes. */
        async loadGrammar(scope)
        {
            if(scope === lgdScope)
            {
                return grammar;
            }

            if(scope === 'source.js')
            {
                const jsGrammarPath = path.join(grammarDirectory, 'JavaScript.tmLanguage.json');
                return textmate.parseRawGrammar(await fs.readFile(jsGrammarPath, 'utf8'), jsGrammarPath);
            }

            return null;
        }
    };

    return new textmate.Registry(registryOptions);
}

function tokenize(grammar, source)
{
    let state = textmate.INITIAL;
    const tokens = [];
    for(const line of source.split('\n'))
    {
        const result = grammar.tokenizeLine(line, state);
        tokens.push(...result.tokens.map(token => ({
            text: line.slice(token.startIndex, token.endIndex),
            scopes: token.scopes
        })));

        state = result.ruleStack;
    }

    return tokens;
}

function assertScope(tokens, text, scope)
{
    assert.ok(
        tokens.some(token => token.text === text && token.scopes.includes(scope)),
        `Expected ${text} to have ${scope}: ${JSON.stringify(tokens)}`
    );
}

function assertPartialScope(tokens, text, partialScope)
{
    const found = tokens.some(token => token.text === text && token.scopes.some(scope => scope.includes(partialScope)));
    assert.ok(found, `Expected ${text} to have a scope containing ${partialScope}: ${JSON.stringify(tokens)}`);
}

function assertNoScope(tokens, text, scope)
{
    assert.ok(
        tokens.every(token => token.text !== text || !token.scopes.includes(scope)),
        `Expected ${text} to never have ${scope}: ${JSON.stringify(tokens)}`
    );
}

describe('LGD TextMate grammar.', () =>
{
    let registry = null;
    let grammar = null;

    beforeAll(async () =>
    {
        registry = await createRegistry();
        grammar = await registry.loadGrammar(lgdScope);
        assert.ok(grammar, 'LGD grammar loaded');
    });

    afterAll(() =>
    {
        if(registry)
        {
            registry.dispose();
        }
    });

    test('highlights typed const locals, including their types and names inside methods', () =>
    {
        const tokens = tokenize(grammar, 'class Command {\n    execute() {\n        const Object editor = vscode.window.activeTextEditor;\n        const String textLine = editor.document.getText();\n    }\n}');
        assertScope(tokens, 'const', LgdKeywordFamilies.families.declaration.scope);
        assertScope(tokens, 'Object', typeScope);
        assertScope(tokens, 'String', typeScope);
        assertScope(tokens, 'editor', nameScope);
        assertScope(tokens, 'textLine', nameScope);
        assertNoScope(tokens, 'const', readonlyScope);
    });

    test('Highlights a typed declaration head.', () =>
    {
        const tokens = tokenize(grammar, 'Number total = 0;');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'total', nameScope);
    });

    test('Highlights enum declarations and names with the existing declaration and type families.', () =>
    {
        const tokens = tokenize(grammar, "export enum DownloadState {\n    Progress = 'progress',\n}");
        assertScope(tokens, 'enum', 'storage.type.lgd');
        assertScope(tokens, 'DownloadState', 'entity.name.type.class.lgd');
    });

    test('Highlights class names and colon-style bases as types while ordinary methods remain functions.', () =>
    {
        const tokens = tokenize(grammar, [
            'export class GoToAssignment : BaseCommand {',
            '    GoToAssignment() : base("command", "title") {}',
            '    async executeCommand() {',
            '        Number total = 1;',
            '    }',
            '}'
        ].join('\n'));
        assertScope(tokens, 'GoToAssignment', 'entity.name.type.class.lgd');
        assertScope(tokens, 'BaseCommand', 'entity.name.type.class.lgd');
        assertScope(tokens, 'export', exportScope);
        assertScope(tokens, 'executeCommand', 'entity.name.function.js');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'total', nameScope);
    });

    test('gives constructor initializers and direct base dispatch the expression keyword fallback', () =>
    {
        const source = [
            'class GoToAssignment : BaseCommand {',
            '    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") {}',
            '    async override executeCommand() {',
            '        await base.executeCommand();',
            '        if (ready) { base.executeCommand(); }',
            '        const invoke = () => base.executeCommand();',
            '    }',
            '}'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        const baseTokens = tokens.filter(token => token.text === 'base');
        assert.strictEqual(baseTokens.length, source.match(/\bbase\b/g).length);
        assert.ok(baseTokens.every(token => token.scopes.includes(LgdKeywordFamilies.families.expression.scope)));
        for(const token of baseTokens)
        {
            assert.ok(token.scopes.every(scope => !scope.startsWith('keyword.control')));
        }

        assertScope(tokens, 'executeCommand', 'entity.name.function.js');
    });

    test('leaves ordinary base identifiers, properties, strings, and comments unchanged', () =>
    {
        const source = [
            'const base = { executeCommand() {} }; base.executeCommand();',
            'class Command {',
            '    base() {}',
            '    run(Object base) {',
            '        base(); this.base(); this.base.executeCommand(); object . base . executeCommand();',
            '        const text = "base.executeCommand() : base()";',
            '        const template = `base.executeCommand() : base()`;',
            '        const pattern = /base.executeCommand()/;',
            '        // base.executeCommand() : base()',
            '        /* base.executeCommand() : base() */',
            '    }',
            '}'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        assert.ok(tokens.every(token => !token.scopes.includes(LgdKeywordFamilies.families.expression.scope)));
    });

    test('preserves receiver scopes for this before semantic tokens arrive', () =>
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
        const tokens = tokenize(grammar, source);
        const receivers = tokens.filter(token => token.text === 'this');
        assert.strictEqual(receivers.length, source.match(/\bthis\b/g).length);
        assert.ok(receivers.every(token => token.scopes.includes('variable.language.this.js')));
        for(const word of [ 'if', 'return' ])
        {
            assertPartialScope(tokens, word, 'keyword.control');
            assertNoScope(tokens, word, 'variable.language.this.js');
        }
    });

    test('leaves this member names, strings, and comments outside receiver scopes', () =>
    {
        const tokens = tokenize(grammar, [
            'const holder = { this: 1 }; holder.this;',
            'const methods = { this() {} }; methods.this();',
            'const text = "this";',
            'const template = `this`;',
            'const pattern = /this/;',
            '// this',
            '/* this */'
        ].join('\n'));
        for(const token of tokens)
        {
            assert.ok(token.scopes.every(scope => !scope.startsWith('variable.language')));
        }
    });

    test('Highlights explicit return types separately from named methods.', () =>
    {
        const tokens = tokenize(grammar, 'class Counter {\n    Number count() { return 1; }\n    async void reset() {}\n}');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'void', LgdKeywordFamilies.families.builtin.scope);
        assertScope(tokens, 'count', 'entity.name.function.js');
        assertScope(tokens, 'reset', 'entity.name.function.js');
        assertNoScope(tokens, 'count', nameScope);
    });

    test('Keeps constructor and ordinary method parameter names native while types have an immediate fallback.', () =>
    {
        const tokens = tokenize(grammar, [
            'class Counter {',
            '    Counter(String title, Number offset = 0) {}',
            '    async void reset(String label, Number delta = 0) {}',
            '}'
        ].join('\n'));
        for(const type of [ 'String', 'Number' ])
        {
            const occurrences = tokens.filter(token => token.text === type);
            assert.strictEqual(occurrences.length, 2);
            assert.ok(occurrences.every(token => token.scopes.includes(typeScope)));
        }

        for(const name of [ 'title', 'offset', 'label', 'delta' ])
        {
            assertScope(tokens, name, 'variable.parameter.js');
            assertNoScope(tokens, name, typeScope);
        }
    });

    test('uses distinct declaration, modifier, and builtin keyword families while keeping type names distinct', () =>
    {
        const tokens = tokenize(grammar, [
            'export readonly Number total = 1;',
            'class Base {',
            '    virtual async void run(String title) {}',
            '}',
            'class Derived : Base {',
            '    override async void run(String title) {}',
            '}'
        ].join('\n'));
        for(const word of [ 'export', 'readonly', 'class', 'virtual', 'override', 'async', 'void' ])
        {
            assertScope(tokens, word, LgdKeywordFamilies.get(word).scope);
        }

        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'String', typeScope);
        assertScope(tokens, 'Base', 'entity.name.type.class.lgd');
        assertNoScope(tokens, 'title', 'keyword.control.lgd');
    });

    test('gives contextual public and sealed declaration heads modifier scopes without changing compiler support', () =>
    {
        const tokens = tokenize(grammar, [
            'public sealed class Command {',
            '    public static async void execute() { if(ready) return; else throw new Error(); }',
            '}'
        ].join('\n'));
        for(const word of [ 'public', 'sealed', 'static', 'async' ])
        {
            assertScope(tokens, word, readonlyScope);
        }

        assertScope(tokens, 'class', LgdKeywordFamilies.families.declaration.scope);
        assertScope(tokens, 'void', LgdKeywordFamilies.families.builtin.scope);
        assertScope(tokens, 'Command', 'entity.name.type.class.lgd');
        for(const word of [ 'if', 'return', 'else', 'throw' ])
        {
            assertPartialScope(tokens, word, 'keyword.control');
            assertNoScope(tokens, word, readonlyScope);
        }
    });

    test('preserves keyword-like member names, identifiers, and literal text', () =>
    {
        const tokens = tokenize(grammar, [
            'const public = 1, sealed = 2, virtual = 3;',
            'const words = { public() {}, sealed() {}, async() {}, static() {} };',
            'words.public(); words.sealed(); words.virtual(); words.async(); words.static();',
            'const text = "public sealed class Fake { async void run() {} }";',
            'const template = `public sealed class Fake { async void run() {} }`;',
            '// public sealed class Fake { async void run() {} }',
            '/* public sealed class Fake { async void run() {} } */'
        ].join('\n'));
        for(const word of [ 'public', 'sealed', 'virtual', 'async', 'static' ])
        {
            assertNoScope(tokens, word, readonlyScope);
        }

        assert.ok(tokens.every(token => !token.scopes.includes('entity.name.type.class.lgd')));
        assert.ok(tokens.every(token => !token.scopes.includes(LgdKeywordFamilies.families.builtin.scope)));
    });

    test('Does not highlight class-looking comments or strings as class declarations.', () =>
    {
        const tokens = tokenize(grammar, '// class Example : Base {}\nconst example = `class Fake : Base {}`;');
        assert.ok(tokens.every(token => !token.scopes.includes('entity.name.type.class.lgd')));
    });

    test('Highlights virtual and override as modifiers without changing method or parameter scopes.', () =>
    {
        const tokens = tokenize(grammar, [
            'class Base {',
            '    virtual async void executeCommand(String label) {}',
            '}',
            'class Derived : Base {',
            '    override async void executeCommand(String label) {}',
            '    async override String describe(Number count) { return String(count); }',
            '}'
        ].join('\n'));
        assertScope(tokens, 'virtual', readonlyScope);
        assertScope(tokens, 'override', readonlyScope);
        assertScope(tokens, 'void', LgdKeywordFamilies.families.builtin.scope);
        assertScope(tokens, 'String', typeScope);
        assertScope(tokens, 'executeCommand', 'entity.name.function.js');
        assertScope(tokens, 'describe', 'entity.name.function.js');
        assertScope(tokens, 'label', 'variable.parameter.js');
        assertScope(tokens, 'count', 'variable.parameter.js');
    });

    test('Highlights qualified nullable declarations, returns and parameters without consuming JavaScript names.', () =>
    {
        const source = [
            'vscode.Position? previous = null;',
            'Number? count = null;',
            'class Search {',
            '    static vscode.Position? find(vscode.Position? position, Number? offset) { return position; }',
            '}'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        assertScope(tokens, 'vscode.Position?', typeScope);
        assertScope(tokens, 'Number?', typeScope);
        assertScope(tokens, 'previous', nameScope);
        assertScope(tokens, 'count', nameScope);
        assertScope(tokens, 'static', readonlyScope);
        assertScope(tokens, 'find', 'entity.name.function.js');
        assertScope(tokens, 'position', 'variable.parameter.js');
        assertScope(tokens, 'offset', 'variable.parameter.js');
    });

    test('Highlights readonly, export, and string declarations.', () =>
    {
        const tokens = tokenize(grammar, 'export readonly String name = "Andrew";');
        assertScope(tokens, 'export', exportScope);
        assertScope(tokens, 'readonly', readonlyScope);
        assertScope(tokens, 'String', typeScope);
        assertScope(tokens, 'name', nameScope);
    });

    test('Highlights typed locals inside nested function blocks.', () =>
    {
        const source = [
            'function findNextChar(document, position, char, offset = 0) {',
            '    if(position.character + 1 + offset > 0) {',
            '        readonly String textLine = document.lineAt(position.line).text;',
            '        Number closeBracketIndex = textLine.indexOf(char, position.character + 1 - offset);',
            '    }',
            '}'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        assertScope(tokens, 'readonly', readonlyScope);
        assertScope(tokens, 'String', typeScope);
        assertScope(tokens, 'textLine', nameScope);
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'closeBracketIndex', nameScope);
        assertPartialScope(tokens, '1', 'constant.numeric');
    });

    test('Highlights typed locals inside object methods with typed parameters.', () =>
    {
        const source = [
            'readonly Object GoToNextMethod = {',
            '    getMethodJavaScript(String line, Number i, Array lines) {',
            '        readonly Array jsPatterns = [];',
            '        Boolean tabIndented = line.startsWith(" ");',
            '        readonly Boolean notIndented = line.length > 0;',
            '    }',
            '};'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        assertScope(tokens, 'Array', typeScope);
        assertScope(tokens, 'jsPatterns', nameScope);
        assertScope(tokens, 'Boolean', typeScope);
        assertScope(tokens, 'tabIndented', nameScope);
        assertScope(tokens, 'notIndented', nameScope);
        const readonlyDeclarationCount = 3;
        assert.strictEqual(tokens.filter(token => token.scopes.includes(readonlyScope)).length, readonlyDeclarationCount);
    });

    test('Nested comments and template text are not typed declarations.', () =>
    {
        const source = [
            'function showExamples() {',
            '    /*',
            '    readonly String commentName = "example";',
            '    Number commentTotal = 0;',
            '    */',
            '    const example = `',
            '    readonly String templateName = "example";',
            '    Number templateTotal = 0;',
            '    `;',
            '}'
        ].join('\n');
        const tokens = tokenize(grammar, source);
        const declarationScopes = [ readonlyScope, typeScope, nameScope ];
        const assignedScopes = tokens.flatMap(token => token.scopes);
        assert.ok(declarationScopes.every(scope => !assignedScopes.includes(scope)));
    });

    test('Constructor calls are not declarations.', () =>
    {
        const tokens = tokenize(grammar, 'Number("5");');
        assertNoScope(tokens, 'Number', typeScope);
        assertNoScope(tokens, 'Number', nameScope);
    });

    test('Malformed declarations still highlight the type keyword.', () =>
    {
        const tokens = tokenize(grammar, 'Number value');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'value', nameScope);
    });

    test('Type keywords inside comments are not declarations.', () =>
    {
        const tokens = tokenize(grammar, '// Number total = 0;');
        assertNoScope(tokens, 'Number', typeScope);
        assertNoScope(tokens, 'total', nameScope);
    });

    test('The rest of the line still tokenizes as JavaScript.', () =>
    {
        const tokens = tokenize(grammar, '/** The total. */\nNumber total = 0;');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'total', nameScope);
        assertPartialScope(tokens, '0', 'constant.numeric');
    });
});
