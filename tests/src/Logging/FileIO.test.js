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

test('recursive directory creation reports failures through its callback', async () =>
{
    const filename = path.join(directory, 'file');
    await fs.writeFile(filename, 'content');
    const callback = jest.fn();
    await FileIO.mkdirRecursive(path.join(filename, 'child'), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({ code: expect.any(String), syscall: 'mkdir' });
});
