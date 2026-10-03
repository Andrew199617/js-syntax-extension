const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const LgdProjectIdentity = require('../../../src/Compilers/LgdProjectIdentity');

let directory;
let canonicalDirectory;

/** @description Creates a fixture file and any missing parent directories. */
async function writeFixture(relative, content = '{}')
{
    const filename = path.join(directory, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
    return filename;
}

/** @description Resolves a fixture source with an optional explicit project identity. */
function resolveFixture(relative, projectId)
{
    return LgdProjectIdentity.resolve({ sourcePath: path.join(directory, relative), projectId: projectId });
}

/** @description Creates symlink fixtures when the operating system permits them. */
async function createLink(target, relative, type)
{
    try
    {
        await fs.symlink(target, path.join(directory, relative), type);
        return true;
    }
    catch(error)
    {
        if([ 'EPERM', 'EACCES', 'ENOSYS' ].includes(error.code))
        {
            return false;
        }

        throw error;
    }
}

beforeEach(async () =>
{
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-project-identity-'));
    canonicalDirectory = await fs.realpath(directory);
});

afterEach(async () =>
{
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

test.each([ 'lgdconfig.json', 'package.json' ])('uses the nearest %s across source directories', async manifest =>
{
    await writeFixture(manifest);
    const first = await resolveFixture('First.lgd');
    const second = await resolveFixture('deep/nested/Second.lgd');
    expect(first.projectId).toBe(`manifest:${path.join(canonicalDirectory, manifest)}`);
    expect(second.projectId).toBe(first.projectId);
    expect(second.sourcePath).toBe(path.join(canonicalDirectory, 'deep/nested/Second.lgd'));
});

test('nested manifests define separate projects and LGD config takes precedence in one directory', async () =>
{
    await writeFixture('package.json');
    await writeFixture('nested/package.json');
    await writeFixture('nested/lgdconfig.json');
    const outer = await resolveFixture('Outer.lgd');
    const inner = await resolveFixture('nested/deep/Inner.lgd');
    expect(inner.projectId).toBe(`manifest:${path.join(canonicalDirectory, 'nested/lgdconfig.json')}`);
    expect(inner.projectId).not.toBe(outer.projectId);
});

test('separate package manifests never share identity just because their contents match', async () =>
{
    await writeFixture('first/package.json', '{"name":"same"}');
    await writeFixture('second/package.json', '{"name":"same"}');
    const first = await resolveFixture('first/First.lgd');
    const second = await resolveFixture('second/Second.lgd');
    expect(first.projectId).not.toBe(second.projectId);
});

test('standalone sibling files remain isolated and JS/TS configuration is not a boundary', async () =>
{
    await writeFixture('jsconfig.json');
    await writeFixture('tsconfig.json');
    const first = await resolveFixture('First.lgd');
    const second = await resolveFixture('Second.lgd');
    expect(first.projectId).toBe(`file:${first.sourcePath}`);
    expect(second.projectId).toBe(`file:${second.sourcePath}`);
    expect(second.projectId).not.toBe(first.projectId);
});

test('explicit project IDs override manifests and do not require source files', async () =>
{
    await writeFixture('package.json');
    await writeFixture('nested/lgdconfig.json');
    expect((await resolveFixture('First.lgd', 'shared-project')).projectId).toBe('shared-project');
    expect((await resolveFixture('nested/Second.lgd', 'shared-project')).projectId).toBe('shared-project');
    expect((await resolveFixture('First.lgd', 'different-project')).projectId).toBe('different-project');
    expect(await LgdProjectIdentity.resolve({ projectId: 'explicit-only' })).toEqual({ sourcePath: null, projectId: 'explicit-only' });
});

test('anonymous and invalid sources have no shared inferred project identity', async () =>
{
    expect(await LgdProjectIdentity.resolve()).toEqual({ sourcePath: null, projectId: null });
    expect(await LgdProjectIdentity.resolve({ sourcePath: '', projectId: ' ' })).toEqual({ sourcePath: null, projectId: null });
    expect(await LgdProjectIdentity.resolve({ sourcePath: '\0invalid' })).toEqual({ sourcePath: null, projectId: null });
});

test('manifest creation and removal immediately change identity without a cache', async () =>
{
    const standalone = await resolveFixture('Source.lgd');
    const manifestPath = await writeFixture('lgdconfig.json');
    expect((await resolveFixture('Source.lgd')).projectId).toBe(`manifest:${path.join(canonicalDirectory, 'lgdconfig.json')}`);
    await fs.unlink(manifestPath);
    expect(await resolveFixture('Source.lgd')).toEqual(standalone);
});

test('directory symlinks canonicalize existing and not-yet-created source paths', async () =>
{
    await writeFixture('real/package.json');
    await writeFixture('real/Existing.lgd', '');
    if(!await createLink(path.join(directory, 'real'), 'alias', 'junction'))
    {
        return;
    }

    expect(await resolveFixture('alias/Existing.lgd')).toEqual(await resolveFixture('real/Existing.lgd'));
    expect(await resolveFixture('alias/new/deep/Future.lgd')).toEqual(await resolveFixture('real/new/deep/Future.lgd'));
});

test('manifest symlinks use actual file identity rather than the importing directory', async () =>
{
    const manifestPath = await writeFixture('manifests/project.json');
    await fs.mkdir(path.join(directory, 'first'));
    await fs.mkdir(path.join(directory, 'second'));
    if(!await createLink(manifestPath, 'first/lgdconfig.json') || !await createLink(manifestPath, 'second/lgdconfig.json'))
    {
        return;
    }

    const first = await resolveFixture('first/Source.lgd');
    expect(first.projectId).toBe(`manifest:${path.join(canonicalDirectory, 'manifests/project.json')}`);
    expect((await resolveFixture('second/Source.lgd')).projectId).toBe(first.projectId);
});

test('dangling source and manifest symlinks fail closed', async () =>
{
    await writeFixture('package.json');
    if(!await createLink(path.join(directory, 'missing.lgd'), 'Source.lgd'))
    {
        return;
    }

    expect(await resolveFixture('Source.lgd')).toEqual({ sourcePath: null, projectId: null });
    await fs.mkdir(path.join(directory, 'nested'));
    if(!await createLink(path.join(directory, 'missing.json'), 'nested/lgdconfig.json'))
    {
        return;
    }

    expect((await resolveFixture('nested/Source.lgd')).projectId).toBeNull();
});

test('inaccessible canonical source resolution fails closed', async () =>
{
    const denied = Object.assign(new Error('Source unavailable'), { code: 'EACCES' });
    jest.spyOn(fs, 'realpath').mockRejectedValue(denied);
    expect(await resolveFixture('Source.lgd')).toEqual({ sourcePath: null, projectId: null });
});

test('inaccessible manifest discovery cannot fall back to an outer project', async () =>
{
    await writeFixture('package.json');
    await writeFixture('nested/Source.lgd', '');
    const deniedPath = path.join(canonicalDirectory, 'nested/lgdconfig.json');
    const originalLstat = fs.lstat;
    jest.spyOn(fs, 'lstat').mockImplementation(filename =>
    {
        if(filename === deniedPath)
        {
            throw Object.assign(new Error('Manifest unavailable'), { code: 'EACCES' });
        }

        return originalLstat(filename);
    });

    expect((await resolveFixture('nested/Source.lgd')).projectId).toBeNull();
});
