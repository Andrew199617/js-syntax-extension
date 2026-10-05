const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdFixService = require('../../../src/Editors/VSCode/LgdFixService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');
const createLgdDiagnostics = require('../../../src/Lgd/LgdDiagnostics');

/** @description Creates real compiler diagnostics with controlled configuration and atomic source edits. */
async function fixture(source, options = {}, jestApi)
{
    const service = LgdLanguageService.create({ set: jestApi.fn(), delete: jestApi.fn() }, error =>
    {
        throw error;
    });

    const document = makeTextDocument('file:///project/example.lgd', source);
    document.version = 1;
    document.languageId = 'lgd';
    await service.openDocument(document);
    const fixes = LgdFixService.create(service);
    const config = { valid: true, ignored: false, root: '/project', autoFix: false, rules: {}, ...options };
    fixes.configuration = { resolve: jestApi.fn(() => Promise.resolve(config)), isCurrent: jestApi.fn(() => Promise.resolve(true)), buffersCurrent: jestApi.fn(() => true) };
    fixes.formattingDiagnostics.configuration = fixes.configuration;
    const baseApply = vscode.workspace.applyEdit.getMockImplementation();
    vscode.workspace.applyEdit.mockImplementation(edit =>
    {
        const sourceEdits = edit.replacements.filter(replacement => replacement.uri.toString() === document.uri.toString());
        const ordered = sourceEdits.sort((left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start));
        for(const replacement of ordered)
        {
            const start = document.offsetAt(replacement.range.start);
            const end = document.offsetAt(replacement.range.end);
            const text = document.getText();
            document.setText(text.slice(0, start) + replacement.newText + text.slice(end));
        }

        if(sourceEdits.length > 0)
        {
            document.version++;
        }

        return baseApply(edit);
    });

    return { service: service, fixes: fixes, document: document, config: config };
}

/** @description Requests native quick fixes through the real compiler and configured bulk service. */
async function quickFixFixture(source, options, jestApi)
{
    const opened = await fixture(source, options, jestApi);
    const { service, fixes, document } = opened;
    const diagnostics = createLgdDiagnostics(document, service.getState(document.uri).errors);
    const provider = LgdCodeActionProvider.create(service, fixes);
    const range = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
    return { ...opened, diagnostics: diagnostics, provider: provider, range: range };
}

/** @description Binds the test runner while sharing the real compiler and native edit fixture. */
function createFixtureApi(jestApi)
{
    return { fixture: (source, options) => fixture(source, options, jestApi), quickFixFixture: (source, options) => quickFixFixture(source, options, jestApi) };
}

module.exports = createFixtureApi;
