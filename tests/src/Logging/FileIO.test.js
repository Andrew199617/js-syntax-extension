const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const FileIO = require('../../../src/Logging/FileIO');

let directory;

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

test('renaming creates the destination and removes an empty source directory', async () =>
{
    const oldDirectory = path.join(directory, 'old');
    const oldPath = path.join(oldDirectory, 'example.d.ts');
    const newPath = path.join(directory, 'new', 'nested', 'example.d.ts');
    await FileIO.writeFileContents(oldPath, 'declaration');
    const callback = jest.fn();
    await FileIO.rename(oldPath, newPath, callback);
    expect(await fs.readFile(newPath, 'utf8')).toBe('declaration');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    await expect(fs.access(oldDirectory)).rejects.toHaveProperty('code', 'ENOENT');
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

test('recursive directory creation reports failures through its callback', async () =>
{
    const filename = path.join(directory, 'file');
    await fs.writeFile(filename, 'content');
    const callback = jest.fn();
    await FileIO.mkdirRecursive(path.join(filename, 'child'), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ code: expect.any(String), syscall: 'mkdir' });
});
