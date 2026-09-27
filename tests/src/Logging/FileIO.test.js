const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const FileIO = require('../../../src/Logging/FileIO');

let directory;

function deferred()
{
    let resolve;
    const promise = new Promise(resolvePromise =>
    {
        resolve = resolvePromise;
    });

    return { promise: promise, resolve: resolve };
}

beforeEach(async () =>
{
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-file-io-'));
});

afterEach(async () =>
{
    await fs.rm(directory, { recursive: true, force: true });
});

test('writing creates every missing parent directory before resolving', async () =>
{
    const filename = path.join(directory, 'nested', 'typings', 'example.d.ts');
    await FileIO.writeFileContents(filename, 'declare const example: string;');
    expect(await fs.readFile(filename, 'utf8')).toBe('declare const example: string;');
});

test('renaming creates the destination and preserves the directory of a pending sibling write', async () =>
{
    const oldDirectory = path.join(directory, 'old');
    const oldPath = path.join(oldDirectory, 'example.d.ts');
    const newPath = path.join(directory, 'new', 'nested', 'example.d.ts');
    const siblingPath = path.join(oldDirectory, 'sibling.d.ts');
    await FileIO.writeFileContents(oldPath, 'declaration');
    const writeStarted = deferred();
    const continueWrite = deferred();
    const writeContents = fs.writeFile;
    const writeFile = jest.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) =>
    {
        writeStarted.resolve();
        await continueWrite.promise;
        await writeContents(...args);
    });

    const writing = FileIO.writeFileContents(siblingPath, 'sibling');
    const callback = jest.fn();
    try
    {
        await writeStarted.promise;
        await FileIO.rename(oldPath, newPath, callback);
    }
    finally
    {
        continueWrite.resolve();
        writeFile.mockRestore();
        await writing;
    }

    expect(await fs.readFile(newPath, 'utf8')).toBe('declaration');
    expect(await fs.readFile(siblingPath, 'utf8')).toBe('sibling');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    await expect(fs.access(oldPath)).rejects.toHaveProperty('code', 'ENOENT');
});

test('case-only renames update the declaration filename without reporting a collision', async () =>
{
    const oldPath = path.join(directory, 'Example.d.ts');
    const newPath = path.join(directory, 'example.d.ts');
    await FileIO.writeFileContents(oldPath, 'source');
    const callback = jest.fn();
    await FileIO.rename(oldPath, newPath, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(await fs.readFile(newPath, 'utf8')).toBe('source');
    expect(await fs.readdir(directory)).toEqual(['example.d.ts']);
});

test.each([
    [ 'symlink', { dev: 1n, ino: 2n } ],
    [ 'hard link', { dev: 1n, ino: 1n } ]
])('a differently cased %s to the source remains a distinct occupied destination', async (linkType, destinationStats) =>
{
    const oldPath = path.join(directory, 'Example.d.ts');
    const newPath = path.join(directory, 'example.d.ts');
    const sourceStats = { dev: 1n, ino: 1n };

    // Model distinct case-sensitive entries, including aliases with the same target or inode.
    const stat = jest.spyOn(fs, 'stat').mockResolvedValue(sourceStats);
    const lstat = jest.spyOn(fs, 'lstat').mockImplementation(filename => Promise.resolve(filename === oldPath ? sourceStats : destinationStats));
    const realpath = jest.spyOn(fs, 'realpath').mockImplementation(filename => Promise.resolve(filename));
    const rename = jest.spyOn(fs, 'rename').mockResolvedValue();
    const collision = Object.assign(new Error('Destination exists'), { code: 'EEXIST' });
    const copyFile = jest.spyOn(fs, 'copyFile').mockRejectedValue(collision);
    const callback = jest.fn();
    try
    {
        await FileIO.rename(oldPath, newPath, callback);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(collision);
        expect(rename).not.toHaveBeenCalled();
    }
    finally
    {
        stat.mockRestore();
        lstat.mockRestore();
        realpath.mockRestore();
        rename.mockRestore();
        copyFile.mockRestore();
    }
});

test('failed renames report the error once and preserve existing files', async () =>
{
    const existingPath = path.join(directory, 'existing.d.ts');
    await FileIO.writeFileContents(existingPath, 'keep');
    const callback = jest.fn();
    await FileIO.rename(path.join(directory, 'missing.d.ts'), path.join(directory, 'new.d.ts'), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toHaveProperty('code', 'ENOENT');
    expect(await fs.readFile(existingPath, 'utf8')).toBe('keep');
});

test('renaming preserves both declarations when the destination already exists', async () =>
{
    const oldPath = path.join(directory, 'old.d.ts');
    const newPath = path.join(directory, 'new.d.ts');
    await FileIO.writeFileContents(oldPath, 'source');
    await FileIO.writeFileContents(newPath, 'destination');
    const callback = jest.fn();
    await FileIO.rename(oldPath, newPath, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toHaveProperty('code', 'EEXIST');
    expect(await fs.readFile(oldPath, 'utf8')).toBe('source');
    expect(await fs.readFile(newPath, 'utf8')).toBe('destination');
});

test('a failed source removal rolls back the copied declaration so renaming can be retried', async () =>
{
    const oldPath = path.join(directory, 'old.d.ts');
    const newPath = path.join(directory, 'new.d.ts');
    await FileIO.writeFileContents(oldPath, 'source');
    const removalError = new Error('Cannot remove source');
    const unlink = jest.spyOn(fs, 'unlink').mockRejectedValueOnce(removalError);
    const callback = jest.fn();
    try
    {
        await FileIO.rename(oldPath, newPath, callback);
    }
    finally
    {
        unlink.mockRestore();
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(removalError);
    expect(await fs.readFile(oldPath, 'utf8')).toBe('source');
    await expect(fs.access(newPath)).rejects.toHaveProperty('code', 'ENOENT');
    callback.mockClear();
    await FileIO.rename(oldPath, newPath, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(await fs.readFile(newPath, 'utf8')).toBe('source');
    await expect(fs.access(oldPath)).rejects.toHaveProperty('code', 'ENOENT');
});

test('failed rollback preserves both errors and declarations and allows recovery', async () =>
{
    const oldPath = path.join(directory, 'old.d.ts');
    const newPath = path.join(directory, 'new.d.ts');
    await FileIO.writeFileContents(oldPath, 'source');
    const removalError = new Error('Cannot remove source');
    const cleanupError = new Error('Cannot remove copied destination');
    const unlink = jest.spyOn(fs, 'unlink').mockRejectedValueOnce(removalError).mockRejectedValueOnce(cleanupError);
    const callback = jest.fn();
    try
    {
        await FileIO.rename(oldPath, newPath, callback);
    }
    finally
    {
        unlink.mockRestore();
    }

    expect(callback).toHaveBeenCalledTimes(1);
    const failure = callback.mock.calls[0][0];
    expect(failure).toBeInstanceOf(globalThis.AggregateError);
    expect(failure.errors).toEqual([ removalError, cleanupError ]);
    expect(failure.cause).toBe(removalError);
    expect(failure.message).toContain(oldPath);
    expect(failure.message).toContain(newPath);
    expect(await fs.readFile(oldPath, 'utf8')).toBe('source');
    expect(await fs.readFile(newPath, 'utf8')).toBe('source');
    await fs.unlink(newPath);
    callback.mockClear();
    await FileIO.rename(oldPath, newPath, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(await fs.readFile(newPath, 'utf8')).toBe('source');
    await expect(fs.access(oldPath)).rejects.toHaveProperty('code', 'ENOENT');
});

test('concurrent renames to the same destination keep the losing source intact', async () =>
{
    const firstPath = path.join(directory, 'first.d.ts');
    const secondPath = path.join(directory, 'second.d.ts');
    const targetPath = path.join(directory, 'target.d.ts');
    await FileIO.writeFileContents(firstPath, 'first');
    await FileIO.writeFileContents(secondPath, 'second');
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();
    await Promise.all([
        FileIO.rename(firstPath, targetPath, firstCallback),
        FileIO.rename(secondPath, targetPath, secondCallback)
    ]);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);
    const callbacks = [ firstCallback, secondCallback ];
    expect(callbacks.filter(callback => callback.mock.calls[0].length === 0)).toHaveLength(1);
    const failure = callbacks.find(callback => callback.mock.calls[0].length > 0);
    expect(failure.mock.calls[0][0]).toHaveProperty('code', 'EEXIST');
    if(failure === firstCallback)
    {
        expect(await fs.readFile(firstPath, 'utf8')).toBe('first');
        expect(await fs.readFile(targetPath, 'utf8')).toBe('second');
        await expect(fs.access(secondPath)).rejects.toHaveProperty('code', 'ENOENT');
    }
    else
    {
        expect(await fs.readFile(secondPath, 'utf8')).toBe('second');
        expect(await fs.readFile(targetPath, 'utf8')).toBe('first');
        await expect(fs.access(firstPath)).rejects.toHaveProperty('code', 'ENOENT');
    }
});

test.each([ 'source', 'destination' ])('a write to the %s during a move keeps its latest contents', async writeTarget =>
{
    const oldPath = path.join(directory, 'old.d.ts');
    const newPath = path.join(directory, 'new.d.ts');
    const unrelatedPath = path.join(directory, 'unrelated.d.ts');
    const writePath = writeTarget === 'source' ? oldPath : newPath;
    await FileIO.writeFileContents(oldPath, 'original');
    const copyFileContents = fs.copyFile;
    const writeFile = jest.spyOn(fs, 'writeFile');

    // All parents already exist. Resolve mkdir immediately to control write ordering.
    const mkdir = jest.spyOn(fs, 'mkdir').mockResolvedValue();
    let writing;
    const copyFile = jest.spyOn(fs, 'copyFile').mockImplementation(async (...args) =>
    {
        await copyFileContents(...args);
        writing = FileIO.writeFileContents(writePath, 'latest');

        // An unrelated write must still finish while this move holds its paths.
        await FileIO.writeFileContents(unrelatedPath, 'independent');

        // Complete any writes that started during the copy before allowing unlink.
        await Promise.all(writeFile.mock.results.map(result => result.value));
    });

    const callback = jest.fn();
    try
    {
        await FileIO.rename(oldPath, newPath, callback);
        await writing;
    }
    finally
    {
        copyFile.mockRestore();
        mkdir.mockRestore();
        writeFile.mockRestore();
    }

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(await fs.readFile(writePath, 'utf8')).toBe('latest');
    expect(await fs.readFile(unrelatedPath, 'utf8')).toBe('independent');
    if(writeTarget === 'source')
    {
        expect(await fs.readFile(newPath, 'utf8')).toBe('original');
    }
    else
    {
        await expect(fs.access(oldPath)).rejects.toHaveProperty('code', 'ENOENT');
    }
});

test('a failed write does not block later writes or renames for the same path', async () =>
{
    const oldPath = path.join(directory, 'old.d.ts');
    const newPath = path.join(directory, 'new.d.ts');
    const failure = new Error('Cannot write declaration');
    const writeFile = jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(failure);
    try
    {
        await expect(FileIO.writeFileContents(oldPath, 'failed')).rejects.toBe(failure);
    }
    finally
    {
        writeFile.mockRestore();
    }

    await FileIO.writeFileContents(oldPath, 'latest');
    const callback = jest.fn();
    await FileIO.rename(oldPath, newPath, callback);
    expect(callback).toHaveBeenCalledWith();
    expect(await fs.readFile(newPath, 'utf8')).toBe('latest');
    await expect(fs.access(oldPath)).rejects.toHaveProperty('code', 'ENOENT');
});

test('recursive directory creation reports failures through its callback', async () =>
{
    const filename = path.join(directory, 'file');
    await fs.writeFile(filename, 'content');
    const callback = jest.fn();
    await FileIO.mkdirRecursive(path.join(filename, 'child'), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ code: expect.any(String), syscall: 'mkdir' });
});
