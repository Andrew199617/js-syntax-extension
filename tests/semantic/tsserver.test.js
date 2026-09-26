const assert = require('assert').strict;
const { spawn } = require('child_process')
const fs = require('fs').promises;
const operatingSystem = require('os');
const path = require('path');

// Match the extension's registered TypeScript plugin.
const pluginName = 'lgd-callback-parameter-highlighting';

// Bound each server request independently of the overall Jest timeout.
const timeoutMilliseconds = 30000;

// Allow server startup and protocol requests to finish on slower CI machines.
const testTimeoutMilliseconds = 120000;

// Include both a callback parameter and real async functions.
const source = '/** @param {function(string): void} report */\n'
  + 'async function scanCandidates(report) { report("Scanning"); }\n'
  + 'async function readAvailableProfiles() { return []; }\n';

async function verifyServer(configuredProject)
{
    const serverPath = process.env.TS_SERVER_PATH || require.resolve('typescript-test-6-0/lib/tsserver.js');
    const directory = await fs.mkdtemp(path.join(operatingSystem.tmpdir(), 'callback-parameter-smoke-'));
    const probe = process.env.PLUGIN_PROBE_PATH || path.join(directory, 'probe');
    const pluginPath = path.join(probe, 'node_modules', pluginName);
    if(!process.env.PLUGIN_PROBE_PATH)
    {
        await fs.mkdir(pluginPath, { recursive: true });
        const sourcePath = path.resolve(__dirname, '../../src/SemanticHighlighting/CallbackParameters.js');
        await fs.copyFile(sourcePath, path.join(pluginPath, 'index.js'));
    }

    if(configuredProject)
    {
        await fs.writeFile(path.join(directory, 'jsconfig.json'), '{"compilerOptions":{"checkJs":true}}');
    }

    const file = path.join(directory, 'sample.js');
    const log = path.join(directory, 'tsserver.log');
    await fs.writeFile(file, source);
    const server = spawn(process.execPath, [
        serverPath,
        '--globalPlugins',
        pluginName,
        '--pluginProbeLocations',
        probe,
        '--allowLocalPluginLoads',
        '--useInferredProjectPerProjectRoot',
        '--disableAutomaticTypingAcquisition',
        '--logVerbosity',
        'verbose',
        '--logFile',
        log
    ], { windowsHide: true });
    let sequence = 0;
    let buffer = Buffer.alloc(0);
    const pending = new Map();
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.stdout.on('data', chunk =>
    {
        buffer = Buffer.concat([ buffer, chunk ]);
        let headerEnd = buffer.indexOf('\r\n\r\n');
        while(headerEnd !== -1)
        {
            const header = buffer.subarray(0, headerEnd).toString();
            const length = Number(header.slice(header.indexOf(':') + 1).trim());
            const bodyStart = headerEnd + Buffer.byteLength('\r\n\r\n');
            if(buffer.length < bodyStart + length)
            {
                break;
            }

            const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString());
            buffer = buffer.subarray(bodyStart + length);
            if(message.type === 'response' && pending.has(message.request_seq))
            {
                pending.get(message.request_seq)(message);
                pending.delete(message.request_seq);
            }

            headerEnd = buffer.indexOf('\r\n\r\n');
        }
    });

    function request(command, args)
    {
        sequence++;
        const seq = sequence;
        return new Promise((resolve, reject) =>
        {
            const timer = setTimeout(() => reject(new Error(`Timed out: ${command}; log: ${log}`)), timeoutMilliseconds);
            pending.set(seq, message =>
            {
                clearTimeout(timer);
                resolve(message);
            });

            server.stdin.write(`${JSON.stringify({ seq: seq, type: 'request', command: command, arguments: args })}\n`);
        });
    }

    try
    {
        await request('open', { file: file, fileContent: source, projectRootPath: directory });
        const project = await request('projectInfo', { file: file, needFileNameList: false });
        if(configuredProject)
        {
            assert.ok(project.body.configFileName.endsWith('jsconfig.json'));
        }
        else
        {
            assert.match(project.body.configFileName, /inferredProject/);
        }

        const result = await request('encodedSemanticClassifications-full', {
            file: file, start: 0, length: source.length, format: '2020'
        });
        assert.equal(result.success, true);

        // Exact encoded values include declaration and async bits from the original server response.
        const parameterDeclaration = 1793;
        const parameterReference = 1792;
        const asyncFunctionDeclaration = 2821;
        assert.deepEqual(result.body.spans, [
            source.indexOf('scanCandidates'),
            'scanCandidates'.length,
            asyncFunctionDeclaration,
            source.indexOf('report)', source.indexOf('scanCandidates')),
            'report'.length,
            parameterDeclaration,
            source.indexOf('report("'),
            'report'.length,
            parameterReference,
            source.indexOf('readAvailableProfiles'),
            'readAvailableProfiles'.length,
            asyncFunctionDeclaration
        ]);
        const contents = await fs.readFile(log, 'utf8');
        assert.ok(contents.includes('[callback-parameters] plugin loaded'));
        assert.ok(contents.includes('[callback-parameters] semantic request intercepted'));
    }
    finally
    {
        await new Promise(resolve =>
        {
            server.once('close', resolve);
            server.kill();
        });
    }
}

test('tsserver loads the plugin in a project without jsconfig.json', async () =>
{
    await verifyServer(false);
}, testTimeoutMilliseconds);

test('tsserver loads the plugin in a project with jsconfig.json', async () =>
{
    await verifyServer(true);
}, testTimeoutMilliseconds);
