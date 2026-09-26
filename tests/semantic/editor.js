const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

// Delay in milliseconds between semantic token requests.
const retryInterval = 250;

// Maximum time in milliseconds to wait for semantic tokens.
const maximumWait = 60000;

// Number of encoded integers per semantic token.
const tokenWidth = 5;

// Offset of the token type within an encoded token.
const tokenTypeIndex = 3;

// Offset of the modifier bits within an encoded token.
const tokenModifierIndex = 4;

function decode(document, legend, tokens)
{
    let line = 0;
    let character = 0;
    const decoded = [];
    for(let index = 0; index < tokens.data.length; index += tokenWidth)
    {
        const deltaLine = tokens.data[index];
        line += deltaLine;
        character = deltaLine === 0 ? character + tokens.data[index + 1] : tokens.data[index + 1];
        const range = new vscode.Range(line, character, line, character + tokens.data[index + 2]);
        const bits = tokens.data[index + tokenModifierIndex];
        decoded.push({
            text: document.getText(range),
            line: line,
            character: character,
            type: legend.tokenTypes[tokens.data[index + tokenTypeIndex]],
            modifiers: legend.tokenModifiers.filter((modifier, bit) => bits & 1 << bit)
        });
    }

    return decoded;
}

async function run()
{
    const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const extension = vscode.extensions.getExtension('learn-game-development.js-syntax-extension');
    assert.ok(extension, 'Packaged extension is installed in the isolated extensions directory');
    assert.equal(extension.packageJSON.version, '2.7.10');
    await extension.activate();
    const builtIn = vscode.extensions.getExtension('vscode.typescript-language-features');
    await builtIn.activate();
    const document = await vscode.workspace.openTextDocument(path.join(folder, 'sample.js'));
    await vscode.window.showTextDocument(document);
    const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    let decoded = [];
    const deadline = Date.now() + maximumWait;
    while(Date.now() < deadline)
    {
        const legend = await vscode.commands.executeCommand('vscode.provideDocumentRangeSemanticTokensLegend', document.uri);
        const tokens = await vscode.commands.executeCommand('vscode.provideDocumentRangeSemanticTokens', document.uri, range);
        if(legend && tokens)
        {
            decoded = decode(document, legend, tokens);
            if(decoded.filter(token => token.text === 'report' && token.type === 'parameter').length === 2)
            {
                break;
            }
        }

        await new Promise(resolve => setTimeout(resolve, retryInterval));
    }

    const reports = decoded.filter(token => token.text === 'report');
    assert.equal(reports.length, 2, JSON.stringify(decoded));
    assert.ok(reports.every(token => token.type === 'parameter'), JSON.stringify(decoded));
    assert.ok(reports[0].modifiers.includes('declaration'));
    const realFunction = decoded.find(token => token.text === 'readAvailableProfiles');
    assert.equal(realFunction.type, 'function');
    assert.ok(realFunction.modifiers.includes('async'));
    assert.ok(realFunction.modifiers.includes('declaration'));
    const result = {
        vscode: vscode.version,
        extension: extension.packageJSON.version,
        extensionPath: extension.extensionPath,
        tokens: decoded
    };
    await fs.writeFile(path.join(folder, 'editor-verification.json'), `${JSON.stringify(result, null, 2)}\r\n`);
    console.log(JSON.stringify(result, null, 2));
}

module.exports = { run: run };
