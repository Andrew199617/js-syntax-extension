const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');
const UseStaticTypeReceiverFix = require('../../../src/Lgd/QuickFixes/UseStaticTypeReceiverFix');
const QuickFixContext = require('../../../src/Lgd/QuickFixes/QuickFixContext');

/** @description Exercises native code-action commands with live source text and real compiler diagnostics. */
async function openFixture(source, options = {}, filename = '/workspace/StaticReceiver.lgd')
{
    const diagnostics = new Map();
    const collection = { set: (uri, entries) => diagnostics.set(uri.toString(), entries), delete: uri => diagnostics.delete(uri.toString()) };
    const service = LgdLanguageService.create(collection, error =>
    {
        throw error;
    }, () => options);

    const document = makeTextDocument(`file://${filename}`, source);
    document.version = 1;
    await service.openDocument(document);
    const originalApply = vscode.workspace.applyEdit.getMockImplementation();
    vscode.workspace.applyEdit.mockImplementation(edit =>
    {
        for(const replacement of edit.replacements)
        {
            const state = service.getState(replacement.uri);
            if(state)
            {
                const target = state.document;
                const start = target.offsetAt(replacement.range.start);
                const end = target.offsetAt(replacement.range.end);
                const text = target.getText();
                target.setText(text.slice(0, start) + replacement.newText + text.slice(end));
                target.version++;
            }
        }

        return originalApply(edit);
    });

    return { service: service, document: document, diagnostics: diagnostics, provider: LgdCodeActionProvider.create(service) };
}

/** @description Requests fixes using transported editor diagnostics instead of private compiler metadata. */
function actionsFor(fixture)
{
    const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
    const range = new vscode.Range(fixture.document.positionAt(0), fixture.document.positionAt(fixture.document.getText().length));
    return fixture.provider.provideCodeActions(fixture.document, range, { diagnostics: JSON.parse(JSON.stringify(diagnostics)) }, {});
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = { QuickFix: { value: 'quickfix' } };
    api.window = { setStatusBarMessage: jest.fn() };
    api.Uri = { file: filename => require('./fakeVscode').makeTextDocument(`file://${filename}`, '').uri };
    return api;
});

/** @description Restores shared fake behavior before independent source fixtures. */
const baselineApplyEdit = vscode.workspace.applyEdit.getMockImplementation();

beforeEach(() =>
{
    vscode.__reset();
    vscode.workspace.applyEdit.mockImplementation(baselineApplyEdit);
    vscode.workspace.applyEdit.mockClear();
});

describe('LGD static type receiver quick fix', () =>
{
    test.each([ 'oloo', 'class' ])('offers and applies an unpreferred receiver-only edit in the %s output model', async javascriptObjectModel =>
    {
        const source = 'class Player { static Number count = 0; }\r\nPlayer player = Player.create();\r\n// café: keep this comment\r\nconst result = player /* keep */ .count;';
        const fixture = await openFixture(source, { javascriptObjectModel: javascriptObjectModel });
        const state = fixture.service.getState(fixture.document.uri);
        const diagnostic = state.errors.find(error => error.code === 'lgd.member.receiverKind');
        expect(source.slice(diagnostic.offset, diagnostic.endOffset)).toBe('count');
        expect(diagnostic.quickFix).toMatchObject({ kind: 'useStaticTypeReceiver', receiverName: 'player', typeName: 'Player', memberName: 'count' });
        const [action] = await actionsFor(fixture);
        expect(action.title).toBe("Use 'Player' to access static member 'count'");
        expect(action.isPreferred).toBe(false);
        expect(action.edit).toBeUndefined();
        expect(action.diagnostics[0].code).toBe('type');
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(fixture.document.getText()).toBe(source.replace('player /* keep */ .count', 'Player /* keep */ .count'));
        expect(fixture.service.getState(fixture.document.uri).errors).toEqual([]);
    });

    test.each([
        [ 'class Player { static Number read() { return 1; } }', 'read', 'player.read()' ],
        [ 'class Base { static Number count; }\r\nclass Player : Base {}', 'count', 'player.count' ]
    ])('supports known static methods and locally closed inheritance: %s', async (declaration, memberName, access) =>
    {
        const source = `${declaration}\r\nPlayer player = Player.create();\r\nconst result = ${access};`;
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture);
        expect(action.title).toBe(`Use 'Player' to access static member '${memberName}'`);
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(fixture.document.getText()).toBe(source.replace(access, access.replace('player.', 'Player.')));
        expect(fixture.service.getState(fixture.document.uri).errors).toEqual([]);
    });

    test('supports an instance-this receiver and preserves unrelated diagnostic identities after a length-changing edit', async () =>
    {
        const source = 'class Player { static Number count; Number read() { return this.count; } }\r\nNumber unrelated = "wrong";';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture);
        expect(action.title).toBe("Use 'Player' to access static member 'count'");
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(fixture.document.getText()).toBe(source.replace('this.count', 'Player.count'));
        expect(fixture.service.getState(fixture.document.uri).errors).toMatchObject([{ code: 'lgd.assignment.typeMismatch' }]);
    });

    test.each([
        'Player.create().count;',
        'new Player().count;',
        'player?.count;',
        'Player.score;',
        'unknown.count;',
        'const dynamic = unknown(); dynamic.count;',
        'function read(Player) { return player.count; }',
        'const object = { player }; object.player.count;',
        'with (unknown) { player.count; }',
        'eval("Player = unknown;"); player.count;'
    ])('withholds a fix for unsafe, uncertain, optional, or opposite-kind access: %s', access =>
    {
        const source = `class Player { static Number count; Number score; }\r\nPlayer player = Player.create();\r\n${access}`;
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors.some(error => error.quickFix?.kind === 'useStaticTypeReceiver')).toBe(false);
    });

    test('rejects forged metadata and a preview that creates a new assignment type error', async () =>
    {
        const source = 'class Player { static Number count; }\r\nPlayer player = Player.create();\r\nString result = player.count;';
        const fixture = await openFixture(source);
        const state = fixture.service.getState(fixture.document.uri);
        const fix = state.errors.find(error => error.quickFix?.kind === 'useStaticTypeReceiver').quickFix;
        const context = new QuickFixContext(fixture.service, fixture.document, state);
        expect(await context.prepare()).toBe(true);
        expect(await new UseStaticTypeReceiverFix().create(context, { ...fix, memberOffset: fix.memberOffset + 1 })).toBeNull();
        expect(await actionsFor(fixture)).toEqual([]);
    });

    test.each([ 'changed text', 'closed document', 'changed options', 'altered proposal' ])('rejects execution after %s', async change =>
    {
        const options = {};
        const source = 'class Player { static Number count; }\r\nPlayer player = Player.create(); player.count;';
        const fixture = await openFixture(source, options);
        const [action] = await actionsFor(fixture);
        if(change === 'changed text')
        {
            fixture.document.setText(`${source} // edited`);
        }
        else if(change === 'closed document')
        {
            fixture.document.isClosed = true;
        }
        else if(change === 'changed options')
        {
            options.javascriptObjectModel = 'class';
        }
        else
        {
            fixture.provider.proposals.get(action.command.arguments[0]).newText = 'Other';
        }

        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test.each([
        'Object Missing = require("./Missing.js");\r\nclass Player : Missing { static Number count; }',
        'class Player { static Number count; }\r\nNumber invalid = ;',
        'class Base { static Number count; }\r\nclass Player : Base {}'
    ])('withholds fixes for incomplete or malformed imported classes: %s', async playerText =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-partial-static-receiver-'));
        const playerPath = path.join(directory, 'Player.lgd');
        const exported = `${playerText}\r\nmodule.exports = Player;`;
        await fs.promises.writeFile(playerPath, exported);
        const playerDocument = makeTextDocument(`file://${playerPath}`, exported);
        playerDocument.version = 1;
        const originalOpen = vscode.workspace.openTextDocument.getMockImplementation();
        vscode.workspace.openTextDocument.mockImplementation(options =>
        {
            if(options.fsPath === playerPath)
            {
                return playerDocument;
            }

            return originalOpen(options);
        });

        try
        {
            const fixture = await openFixture('Object Player = require("./Player.js");\r\nPlayer player = Player.create(); player.count;', {}, path.join(directory, 'Use.lgd'));
            expect(await actionsFor(fixture)).toEqual([]);
        }
        finally
        {
            vscode.workspace.openTextDocument.mockImplementation(originalOpen);
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('withholds inherited imports when a refreshed ancestor cache cannot prove the old descriptor source closure', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-stale-inherited-static-'));
        const basePath = path.join(directory, 'Base.lgd');
        const playerPath = path.join(directory, 'Player.lgd');
        const baseText = 'class Base { static Number count; }\r\nmodule.exports = Base;';
        const playerText = 'Object Base = require("./Base.js");\r\nclass Player : Base {}\r\nmodule.exports = Player;';
        await fs.promises.writeFile(basePath, baseText);
        await fs.promises.writeFile(playerPath, playerText);
        try
        {
            const fixture = await openFixture('Object Player = require("./Player.js");\r\nPlayer player = Player.create(); player.count;', {}, path.join(directory, 'Use.lgd'));
            const descriptor = fixture.service.getState(fixture.document.uri).externals.get('./Player.js');
            expect(descriptor.members.find(member => member.name === 'count').propertyTypeName).toBe('Number');
            const changedBase = baseText.replace('Number count', 'String count');
            await fs.promises.writeFile(basePath, changedBase);
            await fixture.service.readSourceEntry(basePath);
            expect(fixture.service.exportCache.get(basePath).sourceText).toBe(changedBase);
            expect(descriptor.members.find(member => member.name === 'count').propertyTypeName).toBe('Number');
            expect(await actionsFor(fixture)).toEqual([]);
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('pins direct and transitive imported sources before offer and execution', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-static-receiver-'));
        const basePath = path.join(directory, 'Base.lgd');
        const playerPath = path.join(directory, 'Player.lgd');
        const baseText = 'class Base { static Number count; }\r\nmodule.exports = Base;';
        const playerText = 'Object Base = require("./Base.js");\r\nclass Player { static Number count; }\r\nmodule.exports = Player;';
        await fs.promises.writeFile(basePath, baseText);
        await fs.promises.writeFile(playerPath, playerText);
        const baseDocument = makeTextDocument(`file://${basePath}`, baseText);
        const playerDocument = makeTextDocument(`file://${playerPath}`, playerText);
        baseDocument.version = 1;
        playerDocument.version = 1;
        const originalOpen = vscode.workspace.openTextDocument.getMockImplementation();
        const known = new Map([ [ basePath, baseDocument ], [ playerPath, playerDocument ] ]);
        vscode.workspace.openTextDocument.mockImplementation(options => known.get(options.fsPath) || originalOpen(options));
        try
        {
            const fixture = await openFixture('Object Squad = require("./Player.js");\r\nSquad player = Squad.create(); player.count;', {}, path.join(directory, 'Use.lgd'));
            const [action] = await actionsFor(fixture);
            expect(action.title).toBe("Use 'Squad' to access static member 'count'");
            const proposal = fixture.provider.proposals.get(action.command.arguments[0]);
            expect(proposal.snapshots.map(snapshot => snapshot.document.uri.fsPath)).toEqual(expect.arrayContaining([ basePath, playerPath ]));
            baseDocument.setText(baseText.replace('Number count', 'String count'));
            baseDocument.version++;
            expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
            expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
            expect(await actionsFor(fixture)).toEqual([]);
        }
        finally
        {
            vscode.workspace.openTextDocument.mockImplementation(originalOpen);
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
