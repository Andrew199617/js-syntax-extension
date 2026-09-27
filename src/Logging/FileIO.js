const path = require('path');
const fs = require('fs').promises;
const { COPYFILE_EXCL } = require('fs').constants;

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

    const [ oldRealPath, newRealPath ] = await Promise.all([ fs.realpath(oldPath), fs.realpath(newPath) ]);
    if(oldRealPath !== newRealPath)
    {
        return false;
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
            throw new globalThis.AggregateError([ error, cleanupError ], message, { cause: error });
        }

        throw error;
    }
}

/** @description File operations used when writing and moving generated declarations. */
const FileIO = {
    async writeFileContents(filepath, content)
    {
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, content);
    },

    async mkdirRecursive(fullDir, callback)
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
    },

    /** @description Moves a declaration without overwriting an existing destination, then removes its empty old directory. */
    async rename(oldPath, newPath, callback)
    {
        try
        {
            await fs.mkdir(path.dirname(newPath), { recursive: true });
            if(!await tryCaseOnlyRename(oldPath, newPath))
            {
                await fs.copyFile(oldPath, newPath, COPYFILE_EXCL);
                await removeSourceOrRollback(oldPath, newPath);
            }
        }
        catch(error)
        {
            callback(error);
            return;
        }

        const oldDir = path.dirname(oldPath);
        try
        {
            const files = await fs.readdir(oldDir);
            if(!files.length)
            {
                await fs.rmdir(oldDir);
                console.log(`LGD: Removed Old Dir ${oldDir}`);
            }
        }
        catch(error)
        {
            console.error(error);
        }

        callback();
    }
};

module.exports = FileIO;
