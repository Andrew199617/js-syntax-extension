const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');
const LgdMirrorCompletion = require('../../../src/Lgd/LgdMirrorCompletion');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdReferenceProvider = require('../../../src/Lgd/LgdReferenceProvider');

/** @description Opens an unchanged source and retires its original mirror through the requested preview lifecycle. */
async function openPreview(lifecycle)
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const source = 'const Number documentedLine = 1;\r\ndocumentedLine;\r\nconst string[] lines = ["one"];\r\nlines.pu';
    const document = makeTextDocument('file:///workspace/Preview.lgd', source);
    const state = await service.openDocument(document);
    const original = state.jsDocument;
    const preserved = [original];
    if(lifecycle === 'saved')
    {
        original.isClosed = true;
        preserved.push(makeTextDocument('file:///workspace/Preview.js', `${original.getText()}// unsaved saved-preview note\r\n`));
    }
    else if(lifecycle === 'closed' || lifecycle === 'recycled')
    {
        original.isClosed = true;
        if(lifecycle === 'recycled')
        {
            vscode.__reset();
            const other = makeTextDocument('file:///workspace/Other.lgd', 'String unrelated = "untouched";');
            const otherState = await service.openDocument(other);
            expect(otherState.jsDocument.uri.toString()).toBe(original.uri.toString());
            preserved.push(otherState.jsDocument);
        }
    }
    else if(lifecycle === 'edited')
    {
        original.setText(`${original.getText()}// unsaved user note\r\n`);
    }
    else if(lifecycle === 'file')
    {
        state.jsDocument = makeTextDocument('file:///workspace/SavedPreview.js', `${original.getText()}// unsaved file note\r\n`);
        preserved.push(state.jsDocument);
    }

    const retired = state.jsDocument;
    return { service: service, document: document, state: state, source: source, retired: retired,
        preserved: preserved.map(preview => ({ document: preview, text: preview.getText() })) };
}

/** @description Requests one of the four mirror-backed editor providers. */
function requestProvider(kind, fixture)
{
    const { service, document, source } = fixture;
    const hoverPosition = document.positionAt(source.indexOf('documentedLine;'));
    if(kind === 'hover')
    {
        return LgdHoverProvider.create(service).provideHover(document, hoverPosition);
    }

    if(kind === 'completion')
    {
        return LgdCompletionProvider.create(service).provideCompletionItems(document, document.positionAt(source.length));
    }

    if(kind === 'definition')
    {
        return LgdDefinitionProvider.create(service).provideDefinition(document, hoverPosition);
    }

    return LgdReferenceProvider.create(service).provideReferences(document, hoverPosition, { includeDeclaration: true });
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
    vscode.workspace.openTextDocument.mockClear();
    vscode.workspace.applyEdit.mockClear();
});

describe('Immediate LGD provider mirror lifecycle', () =>
{
    test.each([ 'saved', 'closed', 'edited', 'file', 'recycled' ])('hover refreshes the %s mirror before delegating from unchanged source', async lifecycle =>
    {
        const fixture = await openPreview(lifecycle);
        const { service, document, state, source, retired, preserved } = fixture;
        const sourceStart = source.indexOf('documentedLine;');
        const sourceRange = new vscode.Range(document.positionAt(sourceStart), document.positionAt(sourceStart + 'documentedLine'.length));
        vscode.commands.executeCommand.mockImplementation((command, uri, position) =>
        {
            if(uri.toString() === retired.uri.toString())
            {
                return [];
            }

            expect(command).toBe('vscode.executeHoverProvider');
            expect(uri).toBe(state.jsDocument.uri);
            expect(state.jsDocument.isClosed).toBe(false);
            expect(state.jsDocument.languageId).toBe('javascript');
            expect(state.jsDocument.getText()).toContain('documentedLine');
            expect(position).toEqual(service.toJsPosition(document.uri, document.positionAt(source.indexOf('documentedLine;'))));
            const end = state.jsDocument.positionAt(state.jsDocument.offsetAt(position) + 'documentedLine'.length);
            return [{ contents: ['const documentedLine: number'], range: new vscode.Range(position, end) }];
        });

        const hover = await requestProvider('hover', fixture);
        expect(hover.contents).toEqual(['const documentedLine: number']);
        expect(hover.range).toEqual(sourceRange);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        expect(state.jsDocument).not.toBe(retired);
        expect(document.getText()).toBe(source);
        for(const preview of preserved)
        {
            expect(preview.document.getText()).toBe(preview.text);
        }
    });

    test.each([ 'saved', 'closed', 'edited', 'file', 'recycled' ])('completion refreshes the %s mirror and maps edits to unchanged source', async lifecycle =>
    {
        const fixture = await openPreview(lifecycle);
        const { service, document, state, source, retired, preserved } = fixture;
        const sourceRange = new vscode.Range(document.positionAt(source.lastIndexOf('pu')), document.positionAt(source.length));
        vscode.commands.executeCommand.mockImplementation((command, uri) =>
        {
            if(uri.toString() === retired.uri.toString())
            {
                return { items: [] };
            }

            expect(command).toBe('vscode.executeCompletionItemProvider');
            expect(uri).toBe(state.jsDocument.uri);
            expect(state.jsDocument.isClosed).toBe(false);
            expect(state.jsDocument.languageId).toBe('javascript');
            const mirrorRange = new vscode.Range(service.toJsPosition(document.uri, sourceRange.start), service.toJsPosition(document.uri, sourceRange.end));
            return { items: [{ label: 'push', textEdit: { range: mirrorRange, newText: 'push' } }] };
        });

        const items = await requestProvider('completion', fixture);
        expect(items).toHaveLength(1);
        expect(items[0].textEdit.range).toEqual(sourceRange);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        expect(state.jsDocument).not.toBe(retired);
        expect(document.getText()).toBe(source);
        for(const preview of preserved)
        {
            expect(preview.document.getText()).toBe(preview.text);
        }
    });

    test('a recycled target URI maps through its live source instead of an older closed mirror', async () =>
    {
        const fixture = await openPreview('closed');
        vscode.__reset();
        const source = 'Number otherValue = 2;\r\notherValue;';
        const document = makeTextDocument('file:///workspace/Other.lgd', source);
        const state = await fixture.service.openDocument(document);
        expect(state.jsDocument.uri.toString()).toBe(fixture.retired.uri.toString());
        const sourceRange = new vscode.Range(document.positionAt(source.indexOf('otherValue')), document.positionAt(source.indexOf('otherValue') + 'otherValue'.length));
        const mirrorRange = new vscode.Range(fixture.service.toJsPosition(document.uri, sourceRange.start), fixture.service.toJsPosition(document.uri, sourceRange.end));
        vscode.commands.executeCommand.mockResolvedValue([new vscode.Location(state.jsDocument.uri, mirrorRange)]);
        const provider = LgdDefinitionProvider.create(fixture.service);
        const result = await provider.provideDefinition(document, document.positionAt(source.lastIndexOf('otherValue')));
        expect(result).toEqual([new vscode.Location(document.uri, sourceRange)]);
    });

    test('ordinary repeated hover and completion calls reuse the unchanged open mirror', async () =>
    {
        const fixture = await openPreview('current');
        const mirror = fixture.state.jsDocument;
        vscode.commands.executeCommand.mockImplementation(command =>
        {
            if(command === 'vscode.executeHoverProvider')
            {
                return [{ contents: ['const documentedLine: number'] }];
            }

            return { items: [{ label: 'push' }] };
        });

        await requestProvider('hover', fixture);
        await requestProvider('completion', fixture);
        await requestProvider('hover', fixture);
        await requestProvider('completion', fixture);
        expect(fixture.state.jsDocument).toBe(mirror);
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test('concurrent hover and completion share one retired-mirror refresh', async () =>
    {
        const fixture = await openPreview('saved');
        vscode.commands.executeCommand.mockImplementation(command =>
        {
            if(command === 'vscode.executeHoverProvider')
            {
                return [{ contents: ['const documentedLine: number'] }];
            }

            return { items: [{ label: 'push' }] };
        });

        const [ hover, completions ] = await Promise.all([ requestProvider('hover', fixture), requestProvider('completion', fixture) ]);
        expect(hover.contents).toEqual(['const documentedLine: number']);
        expect(completions).toHaveLength(1);
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(2);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test('a source changed while waiting for queued updates cannot delegate through its retired mirror', async () =>
    {
        const fixture = await openPreview('closed');
        let release;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });

        fixture.service.pendingUpdates.set(fixture.document.uri.toString(), gate);
        const pending = LgdMirrorCompletion.provide(fixture.service, fixture.document, fixture.document.positionAt(fixture.source.length));
        fixture.document.setText(fixture.source.replace('lines.pu', 'lines.ma'));
        release();
        expect(await pending).toBeNull();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    test('a source closed and reopened during mirror creation cannot receive the old provider result', async () =>
    {
        const fixture = await openPreview('closed');
        let release;
        let started;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });
        const mirrorStarted = new Promise(resolve =>
        {
            started = resolve;
        });
        vscode.workspace.openTextDocument.mockImplementationOnce(async options =>
        {
            started();
            await gate;
            return makeTextDocument('untitled:retired-provider-mirror', options.content);
        });

        const pending = requestProvider('hover', fixture);
        await mirrorStarted;
        fixture.service.closeDocument(fixture.document);
        const reopened = makeTextDocument(fixture.document.uri.toString(), fixture.source);
        const current = await fixture.service.openDocument(reopened);
        const currentMirror = current.jsDocument;
        release();
        expect(await pending).toBeNull();
        expect(fixture.service.getState(reopened.uri)).toBe(current);
        expect(current.jsDocument).toBe(currentMirror);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    test.each([ 'hover', 'completion', 'definition', 'references' ])('%s discards a delegated result if its mirror closes while awaiting it', async kind =>
    {
        const fixture = await openPreview('current');
        let finish;
        let started;
        const commandStarted = new Promise(resolve =>
        {
            started = resolve;
        });
        vscode.commands.executeCommand.mockImplementation(() => new Promise(resolve =>
        {
            finish = resolve;
            started();
        }));

        const pending = requestProvider(kind, fixture);
        await commandStarted;
        const mirror = fixture.state.jsDocument;
        const range = new vscode.Range(mirror.positionAt(0), mirror.positionAt(1));
        mirror.isClosed = true;
        let result = [new vscode.Location(mirror.uri, range)];
        if(kind === 'hover') result = [{ contents: ['stale hover'], range: range }];
        else if(kind === 'completion') result = { items: [{ label: 'stale completion' }] };
        finish(result);
        expect(await pending).toBeNull();
    });
});
