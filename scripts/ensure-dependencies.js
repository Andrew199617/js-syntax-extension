const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

/** @description Anchors dependency checks and installation to the repository. */
const projectRoot = path.resolve(__dirname, '..');

/** @description Installs locked dependencies before building a fresh clone. */
async function ensureDependencies()
{
    try
    {
        await fs.access(path.join(projectRoot, 'node_modules'));
        return 0;
    }
    catch(error)
    {
        if(error.code !== 'ENOENT')
        {
            throw error;
        }
    }

    const npmScript = process.env.npm_execpath;
    if(!npmScript)
    {
        throw new Error('Run this script through npm run build or npm run package.');
    }

    console.log('Dependencies are missing. Running npm ci...');

    // Use npm's CLI through Node so Windows does not need to spawn npm.cmd.
    const installation = spawn(process.execPath, [ npmScript, 'ci' ], {
        cwd: projectRoot,
        stdio: 'inherit'
    });
    const [exitCode] = await once(installation, 'exit');
    return exitCode ?? 1;
}

async function main()
{
    try
    {
        const exitCode = await ensureDependencies();
        process.exitCode = exitCode;
    }
    catch(error)
    {
        console.error(error);
        process.exitCode = 1;
    }
}

main();
