const path = require('path');
const fs = require('fs').promises;
const { COPYFILE_EXCL } = require('fs').constants;

/** @description Pending writes and moves, grouped by absolute filesystem path. */
const pendingOperations = new Map();

/** @description Case-folds queue keys on every platform; filesystem paths keep their original spelling. */
function operationPath(filepath)
{
    const absolutePath = path.resolve(filepath);
    return absolutePath.toLowerCase();
}

/** @description Serializes operations on their source and destination while unrelated files remain independent. */
async function queueFileOperation(filepaths, operation)
{
    const keys = filepaths.map(operationPath);
    const previousOperations = keys.map(key => pendingOperations.get(key));
    let release;
    const completion = new Promise(resolve =>
    {
        release = resolve;
    });

    for(const key of keys)
    {
        pendingOperations.set(key, completion);
    }

    try
    {
        await Promise.all(previousOperations);
        return await operation();
    }
    finally
    {
        for(const key of keys)
        {
            if(pendingOperations.get(key) === completion)
            {
                pendingOperations.delete(key);
            }
        }

        release();
    }
}

/** @description Changes casing only when both paths resolve to the same filesystem entry. */
async function tryCaseOnlyRename(oldPath, newPath)
{
    if(oldPath.toLowerCase() !== newPath.toLowerCase())
    {
        return false;
    }

    let newStats;
    try
    {
        newStats = await fs.lstat(newPath, { bigint: true });
    }
    catch(error)
    {
        if(error.code === 'ENOENT')
        {
            return false;
        }

        throw error;
    }

    const oldStats = await fs.lstat(oldPath, { bigint: true });
    if(oldStats.dev !== newStats.dev || oldStats.ino !== newStats.ino)
    {
        return false;
    }

    const oldDirectory = path.dirname(oldPath);
    const newDirectory = path.dirname(newPath);
    const [ oldDirectoryStats, newDirectoryStats ] = await Promise.all([
        fs.stat(oldDirectory, { bigint: true }),
        fs.stat(newDirectory, { bigint: true })
    ]);
    if(oldDirectoryStats.dev !== newDirectoryStats.dev || oldDirectoryStats.ino !== newDirectoryStats.ino)
    {
        return false;
    }

    const oldName = path.basename(oldPath);
    const newName = path.basename(newPath);
    if(oldName !== newName)
    {
        const filenames = await fs.readdir(oldDirectory);
        if(filenames.includes(oldName) && filenames.includes(newName))
        {
            return false;
        }
    }

    await fs.rename(oldPath, newPath);
    return true;
}

/** @description Removes the source or rolls back the copy, reporting both failures if cleanup is blocked. */
async function removeSourceOrRollback(oldPath, newPath)
{
    try
    {
        await fs.unlink(oldPath);
    }
    catch(error)
    {
        try
        {
            await fs.unlink(newPath);
        }
        catch(cleanupError)
        {
            const message = `Could not remove ${oldPath}: ${error.message}. Rollback of ${newPath} also failed: ${cleanupError.message}. Both declarations remain; resolve the filesystem errors, inspect and remove the copied destination, then retry the rename.`;
            const failure = new Error(message);
            failure.cause = error;
            failure.errors = [ error, cleanupError ];
            throw failure;
        }

        throw error;
    }
}

/** @description Creates the parent directory and writes the file contents. */
async function writeFileContents(filepath, content)
{
    async function writeContents()
    {
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, content);
    }

    await queueFileOperation([filepath], writeContents);
}

/** @description Creates a directory tree and passes any failure to the callback. */
async function mkdirRecursive(fullDir, callback)
{
    try
    {
        await fs.mkdir(fullDir, { recursive: true });
    }
    catch(error)
    {
        callback(error);
        return;
    }

    callback();
}

/** @description Moves a declaration without overwriting its destination or deleting directories used by other writes. */
async function rename(oldPath, newPath, callback)
{
    async function moveDeclaration()
    {
        await fs.mkdir(path.dirname(newPath), { recursive: true });
        if(!await tryCaseOnlyRename(oldPath, newPath))
        {
            await fs.copyFile(oldPath, newPath, COPYFILE_EXCL);
            await removeSourceOrRollback(oldPath, newPath);
        }
    }

    try
    {
        await queueFileOperation([ oldPath, newPath ], moveDeclaration);
    }
    catch(error)
    {
        callback(error);
        return;
    }

    callback();
}

module.exports = {
    writeFileContents: writeFileContents,
    mkdirRecursive: mkdirRecursive,
    rename: rename
};
