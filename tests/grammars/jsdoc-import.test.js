const assert = require('assert').strict;
const fs = require('fs').promises;
const path = require('path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

// Repository root containing the syntax grammars.
const root = path.resolve(__dirname, '../..');

// Identify the extension grammar in its manifest.
const injectionScope = 'source.lgd.jsdoc-import';

// Detect accidental leakage of the import region.
const importScope = 'meta.import.jsdoc';

// Require imported names to receive alias highlighting.
const nameScope = 'variable.other.readwrite.alias.js';

async function createRegistry(inject)
{
    const grammarDirectory = process.env.VSCODE_JS_GRAMMAR_DIR || path.join(__dirname, 'fixtures');
    const wasm = await fs.readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const contribution = manifest.contributes.grammars.find(grammar => grammar.scopeName === injectionScope);
    assert.ok(contribution, 'Injection is registered in the extension manifest');
    const injectionPath = path.join(root, contribution.path);
    const injection = textmate.parseRawGrammar(await fs.readFile(injectionPath, 'utf8'), injectionPath);
    const registryOptions = {
        onigLib: Promise.resolve({
            /** @description Creates the regex scanner used by the test grammar registry. */
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),

            /** @description Wraps a test string for Oniguruma tokenization. */
            createOnigString: value => new oniguruma.OnigString(value)
        }),

        /** @description Returns the JSDoc injection when it applies to the requested scope. */
        getInjections(scope)
        {
            return inject && contribution.injectTo.includes(scope) ? [injectionScope] : [];
        },

        /** @description Loads the injection or host grammar needed by the registry. */
        async loadGrammar(scope)
        {
            if(scope === injectionScope)
            {
                return injection;
            }

            const names = {
                'source.js': 'JavaScript.tmLanguage.json',
                'source.js.jsx': 'JavaScriptReact.tmLanguage.json',
                'source.js.regexp': 'Regular Expressions (JavaScript).tmLanguage'
            };
            if(!names[scope])
            {
                return null;
            }

            const grammarPath = path.join(grammarDirectory, names[scope]);
            return textmate.parseRawGrammar(await fs.readFile(grammarPath, 'utf8'), grammarPath);
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

function defineLanguageTests(scope)
{
    let baseline;
    let enhanced;
    let original;
    let grammar;

    async function loadGrammars()
    {
        baseline = await createRegistry(false);
        enhanced = await createRegistry(true);
        original = await baseline.loadGrammar(scope);
        grammar = await enhanced.loadGrammar(scope);
    }

    function disposeRegistries()
    {
        if(baseline)
        {
            baseline.dispose();
        }

        if(enhanced)
        {
            enhanced.dispose();
        }
    }

    beforeAll(loadGrammars);
    afterAll(disposeRegistries);

    test('screenshot examples', () =>
    {
        const source = "import { Linter } from 'eslint';\n"
          + "/** @import { Node as AstNode } from 'estree' */\n"
          + "/** @import { Rule } from 'eslint' */";
        const tokens = tokenize(grammar, source);
        for(const name of [ 'Node', 'AstNode', 'Rule' ])
        {
            assertScope(tokens, name, nameScope);
        }

        assertScope(tokens, 'as', 'keyword.control.as.js');
        assertScope(tokens, 'from', 'keyword.control.from.js');
        assertScope(tokens, 'estree', 'string.quoted.single.js');
        assert.deepEqual(tokenize(grammar, source.split('\n')[0]), tokenize(original, source.split('\n')[0]));
    });

    test('multiline, default and namespace imports', () =>
    {
        const source = '/**\n * @import {\n * Node as AstNode,\n * Rule\n * } from "types"\n'
          + ' * Ordinary prose after the import.\n * @param {AstNode} node Description.\n */\n'
          + '/** @import DefaultType from "types" */\n'
          + '/** @import * as Namespace from "types" */';
        const tokens = tokenize(grammar, source);
        for(const name of [ 'Node', 'AstNode', 'Rule', 'DefaultType', 'Namespace' ])
        {
            assertScope(tokens, name, nameScope);
        }

        assertScope(tokens, '*', 'constant.language.import-export-all.js');
        assertScope(tokens, 'types', 'string.quoted.double.js');
        const prose = tokens.find(token => token.text.includes('Ordinary prose'));
        assert.ok(!prose.scopes.includes(importScope));
        const param = tokens.find(token => token.text === 'param');
        assert.ok(!param.scopes.includes(importScope));
    });

    test('incomplete imports never swallow the comment terminator or next tag', () =>
    {
        for(const source of [
            '/** @import { Missing */\nconst outside = 1;',
            '/** @import { Missing } from "unfinished */\nconst outside = 1;',
            '/** @import { Missing\n * @param {string} value Description.\n */\nconst outside = 1;'
        ])
        {
            const tokens = tokenize(grammar, source);
            const outside = tokens.find(token => token.text === 'outside');
            assert.ok(outside, JSON.stringify(tokens));
            assert.ok(!outside.scopes.some(tokenScope => tokenScope.startsWith('comment.')));
            assert.ok(!outside.scopes.includes(importScope));
            const nextTag = tokens.find(token => token.text === 'param');
            if(source.includes('@param'))
            {
                assert.ok(nextTag, 'The tag after an incomplete import must remain tokenized');
                assert.ok(!nextTag.scopes.includes(importScope));
            }
        }
    });

    test('unrelated comments, strings, tags and runtime imports stay unchanged', () =>
    {
        for(const source of [
            "// @import { Rule } from 'eslint'",
            "/* @import { Rule } from 'eslint' */",
            'const text = "/** @import { Rule } from \'eslint\' */";',
            '/** @param {function(string): void} report Description. */',
            '/** @type {import("eslint").Rule} */',
            '/** @important unrelated words */',
            "import { Node as AstNode } from 'estree';"
        ])
        {
            assert.deepEqual(tokenize(grammar, source), tokenize(original, source));
        }
    });

    test('closing quotes and trailing descriptions', () =>
    {
        const tokens = tokenize(grammar, '/** @import { $Rule, Nödé } from "pkg\\"name" trailing prose */');
        assertScope(tokens, '$Rule', nameScope);
        assertScope(tokens, 'Nödé', nameScope);
        const trailing = tokens.find(token => token.text.includes('trailing prose'));
        assert.ok(!trailing.scopes.includes(importScope));
    });
}

describe.each([ 'source.js', 'source.js.jsx' ])('JSDoc import injection: %s', defineLanguageTests);
