const path = require('path');
const fs = require('fs').promises;

/** @description File operations used when writing and moving generated declarations. */
const FileIO = {
    /** @description Creates the parent directory and writes the file contents. */
    async writeFileContents(filepath, content)
    {
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, content);
    },

    /** @description Creates a directory tree and passes any failure to the callback. */
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

    /** @description Moves a declaration and removes its old directory if it is empty. */
    async rename(oldPath, newPath, callback)
    {
        try
        {
            await fs.mkdir(path.dirname(newPath), { recursive: true });
            await fs.rename(oldPath, newPath);
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
            if(files.length === 0)
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
