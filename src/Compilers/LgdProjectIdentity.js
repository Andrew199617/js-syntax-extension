const fs = require('fs').promises;
const path = require('path');

/** @description Resolves deterministic LGD compilation boundaries for the compiler and editor. */
const LgdProjectIdentity = {
    /**
     * @description Uses an explicit project identity or the nearest LGD/package manifest, isolating standalone sources.
     * @param {Object} options the optional sourcePath and explicit projectId.
     * @returns {Promise<Object>} canonical sourcePath and projectId, with null for unresolved identities.
     */
    async resolve(options = {})
    {
        const sourcePath = await this._canonicalPath(options?.sourcePath);
        if(typeof options?.projectId === 'string' && options.projectId.trim())
        {
            return { sourcePath: sourcePath, projectId: options.projectId };
        }

        if(!sourcePath)
        {
            return { sourcePath: null, projectId: null };
        }

        let directory = path.dirname(sourcePath);
        while(directory)
        {
            const manifest = await this._manifest(directory);
            if(manifest.failed || manifest.projectId)
            {
                return { sourcePath: sourcePath, projectId: manifest.projectId };
            }

            const parent = path.dirname(directory);
            if(parent === directory)
            {
                return { sourcePath: sourcePath, projectId: `file:${sourcePath}` };
            }

            directory = parent;
        }

        return { sourcePath: sourcePath, projectId: null };
    },

    async _canonicalPath(filename)
    {
        if(typeof filename !== 'string' || !filename.trim() || filename.includes('\0'))
        {
            return null;
        }

        let current = path.resolve(filename);
        const remaining = [];
        while(current)
        {
            try
            {
                return path.join(await fs.realpath(current), ...remaining);
            }
            catch(error)
            {
                if(error.code !== 'ENOENT')
                {
                    return null;
                }

                // A dangling link is not an absent file and cannot establish a safe identity.
                try
                {
                    await fs.lstat(current);
                    return null;
                }
                catch(error_)
                {
                    if(error_.code !== 'ENOENT')
                    {
                        return null;
                    }
                }

                const parent = path.dirname(current);
                if(parent === current)
                {
                    return null;
                }

                remaining.unshift(path.basename(current));
                current = parent;
            }
        }

        return null;
    },

    async _manifest(directory)
    {
        for(const filename of [ 'lgdconfig.json', 'package.json' ])
        {
            const manifestPath = path.join(directory, filename);
            let stats;
            try
            {
                stats = await fs.lstat(manifestPath);
            }
            catch(error)
            {
                if(error.code === 'ENOENT')
                {
                    continue;
                }

                return { projectId: null, failed: true };
            }

            if(!stats.isFile() && !stats.isSymbolicLink())
            {
                continue;
            }

            const canonical = await this._canonicalPath(manifestPath);
            if(!canonical)
            {
                return { projectId: null, failed: true };
            }

            try
            {
                if((await fs.stat(canonical)).isFile())
                {
                    return { projectId: `manifest:${canonical}`, failed: false };
                }
            }
            catch
            {
                return { projectId: null, failed: true };
            }
        }

        return { projectId: null, failed: false };
    }
};

module.exports = LgdProjectIdentity;
