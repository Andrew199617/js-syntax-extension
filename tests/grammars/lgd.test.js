const assert = require('assert').strict;
const fs = require('fs').promises;
const path = require('path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

// Repository root containing the syntax grammars.
const root = path.resolve(__dirname, '../..');

// The LGD language grammar under test.
const lgdScope = 'source.lgd';

// Scope the LGD grammar assigns to type keywords in declaration heads.
const typeScope = 'storage.type.lgd';

// Scope the LGD grammar assigns to declared variable names.
const nameScope = 'variable.other.definition.lgd';

// Scope the LGD grammar assigns to the readonly modifier.
const readonlyScope = 'storage.modifier.readonly.lgd';

// Scope the LGD grammar assigns to the export modifier.
const exportScope = 'keyword.control.export.lgd';

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

    test('Highlights a typed declaration head.', () =>
    {
        const tokens = tokenize(grammar, 'Number total = 0;');
        assertScope(tokens, 'Number', typeScope);
        assertScope(tokens, 'total', nameScope);
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
