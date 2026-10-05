const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Opens visibility syntax using a recording editor service. */
async function openSource(source, options = {})
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined, () => options);
    const document = makeTextDocument('file:///workspace/Visibility.lgd', source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

jest.mock('vscode', () =>
{
    const fake = require('./fakeVscode');

    const api = fake.createFakeVscode(jest);
    api.Uri = { file: filePath => fake.makeTextDocument(`file://${filePath}`, '').uri };
    return api;
});

beforeEach(() => vscode.__reset());

describe('LGD source visibility hovers and highlighting', () =>
{
    test.each([ 'oloo', 'class' ])('Shows explicit class, field, method, accessor, and constructor visibility in %s output.', async objectModel =>
    {
        const source = [
            'internal class Sample {',
            '    public readonly Number value = 1;',
            '    private Sample(Number seed) {}',
            '    protected Number read(Number amount) { return amount; }',
            '    public get Number score() { return this.read(1); }',
            '    private set score(Number next) {}',
            '}',
            'abstract class Contract { public abstract Number score { get; protected set; } }'
        ].join('\n');
        const { service, document, state } = await openSource(source, { javascriptObjectModel: objectModel });
        expect(state.errors).toEqual([]);
        const provider = LgdHoverProvider.create(service);
        const cases = [
            [ 'Sample {', 'internal class Sample' ],
            [ 'value =', 'public readonly Number Sample.value' ],
            [ 'Sample(Number', 'private Sample(Number seed)' ],
            [ 'read(Number', 'protected Number Sample.read(Number amount)' ],
            [ 'score()', 'public get Number Sample.score()' ],
            [ 'score(Number', 'private set Sample.score(Number next)' ],
            [ 'read(1)', 'protected Number Sample.read(Number amount)' ],
            [ 'score {', 'Number Contract.score { public get; protected set; }' ]
        ];
        for(const [ phrase, expected ] of cases)
        {
            const hover = await provider.provideHover(document, document.positionAt(source.indexOf(phrase)));
            expect(hover.contents).toContain(expected);
        }

        const classHover = await provider.provideHover(document, document.positionAt(source.indexOf('Sample {')));
        expect(classHover.contents).toContain('private create(Number seed)');
        expect(classHover.contents).toContain('protected read()');
        expect(classHover.contents).toContain('score: Number { public get; private set; }');
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const modifiers = tokens.pushed.filter(token => token.tokenType === 'lgdModifierKeyword').map(token => document.getText(token.range));
        expect(modifiers).toEqual([ 'internal', 'public', 'readonly', 'private', 'protected', 'public', 'private', 'abstract', 'public', 'abstract', 'protected' ]);
    });

    test('Keeps omitted visibility out of existing public-default summaries and field hovers.', async () =>
    {
        const source = 'class Sample { Number value; Sample() {} Number read() { return this.value; } }';
        const { service, document, state } = await openSource(source);
        expect(state.errors).toEqual([]);
        const provider = LgdHoverProvider.create(service);
        for(const phrase of [ 'Sample {', 'value;' ])
        {
            const hover = await provider.provideHover(document, document.positionAt(source.indexOf(phrase)));
            expect(hover.contents).not.toContain('public');
        }
    });

    test('Highlights explicit type visibility without coloring matching identifiers or literal text.', async () =>
    {
        const source = [
            'public interface IValue { Number read(); }',
            'internal enum Choice { First = 1, Second = 2 }',
            'const internal = 1;',
            'const words = { internal() {} }; words.internal();',
            'const text = "internal public private protected";',
            '// internal public private protected'
        ].join('\n');
        const { service, document, state } = await openSource(source);
        expect(state.errors).toEqual([]);
        const provider = LgdHoverProvider.create(service);
        for(const [ phrase, expected ] of [ [ 'IValue {', 'public interface IValue' ], [ 'Choice {', 'internal enum Choice' ] ])
        {
            const hover = await provider.provideHover(document, document.positionAt(source.indexOf(phrase)));
            expect(hover.contents).toContain(expected);
        }

        const spans = LgdSemanticTokensProvider.create(service).collectSemanticSpans(source, state);
        expect(spans.filter(span => span.tokenType === 'lgdModifierKeyword').map(span => source.slice(span.start, span.end))).toEqual([ 'public', 'internal' ]);
    });

    test('Refreshes imported method and accessor visibility through an alias after source edits.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-visibility-hovers-'));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const source = [
            'public class Root {',
            '    public Root(Number seed) {}',
            '    public Number read(Number amount) { return amount; }',
            '    public get Number score() { return 1; }',
            '    private set score(Number next) {}',
            '    public get Number shared() { return 1; }',
            '    set shared(Number next) {}',
            '}',
            'module.exports = Root;'
        ].join('\n');
        const root = makeTextDocument(`file://${path.join(directory, 'Root.lgd')}`, source);
        const consumerSource = 'const Alias = require("./Root.js");\nAlias item = Alias.create(1);\nitem.read(1); item.score; item.shared;';
        const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, consumerSource);
        try
        {
            await service.openDocument(root);
            const state = await service.openDocument(consumer);
            expect(state.errors).toEqual([]);
            const provider = LgdHoverProvider.create(service);
            const cases = [
                [ 'create(1)', 'Alias.create(Number seed)' ],
                [ 'read(1)', 'public Number Root.read(Number amount)' ],
                [ 'score;', 'Number Root.score { public get; private set; }' ],
                [ 'shared;', 'public Number Root.shared { get; set; }' ]
            ];
            for(const [ phrase, expected ] of cases)
            {
                const hover = await provider.provideHover(consumer, consumer.positionAt(consumerSource.indexOf(phrase)));
                expect(hover.contents).toContain(expected);
            }

            root.setText(source.replace('public Number read', 'internal Number read'));
            await service.updateDocument(root);
            await service.pendingDependencyUpdates;
            const hover = await provider.provideHover(consumer, consumer.positionAt(consumerSource.indexOf('read(1)')));
            expect(hover.contents).toContain('internal Number Root.read(Number amount)');
        }
        finally
        {
            await service.pendingDependencyUpdates;
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
