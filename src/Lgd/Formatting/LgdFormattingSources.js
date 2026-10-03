const path = require('path');
const LgdFormattingOptions = require('./LgdFormattingOptions');
const LgdEditorConfig = require('./LgdEditorConfig');
const LgdClangFormat = require('./LgdClangFormat');
const LgdEslintStyle = require('./LgdEslintStyle');

/** @description Bounded ancestor lookup prevents work proportional to an untrusted path depth. */
const parentLimit = 32;

/** @description Resolves declarative style sources through the caller's bounded, snapshot-aware filesystem reader. */
const LgdFormattingSources = {
    /** @description Reads configured source types in low-to-high precedence order, never outside the workspace. */
    async resolve({ filePath, workspaceRoot, readSnapshot, sources = [ 'editorconfig', 'clang-format', 'eslint' ] })
    {
        const result = { options: {}, rules: {}, snapshots: [], issues: [] };
        const directories = this.directories(filePath, workspaceRoot);
        for(const source of sources)
        {
            let layer;
            if(source === 'editorconfig')
            {
                layer = await this.editorConfig(directories, filePath, readSnapshot, result);
            }
            else if(source === 'clang-format')
            {
                layer = await this.clangFormat(directories, readSnapshot, result);
            }
            else if(source === 'eslint')
            {
                layer = await this.eslint(directories, filePath, readSnapshot, result);
            }
            else
            {
                result.issues.push({ path: workspaceRoot, message: `Unknown formatting source ${source}.`, severity: 'warning' });
                continue;
            }

            this.merge(result, layer);
        }

        return result;
    },

    /** @description Lists parents from the document directory up to the explicit workspace boundary. */
    directories(filePath, workspaceRoot)
    {
        const root = path.resolve(workspaceRoot);
        const file = path.resolve(filePath);
        const relative = path.relative(root, file);
        if(relative.startsWith('..') || path.isAbsolute(relative))
        {
            throw new Error('Formatting source resolution requires a document inside its workspace.');
        }

        const directories = [];
        let directory = path.dirname(file);
        while(directories.length < parentLimit)
        {
            directories.push(directory);
            if(directory === root)
            {
                return directories;
            }

            directory = path.dirname(directory);
        }

        throw new Error('Formatting configuration exceeds the 32-directory workspace limit.');
    },

    /** @description Records missing files too, so creating a higher-precedence configuration invalidates a prepared fix. */
    async read(filename, readSnapshot, result)
    {
        const snapshot = await readSnapshot(filename);
        if(!snapshot || typeof snapshot.path !== 'string' || snapshot.text !== null && typeof snapshot.text !== 'string')
        {
            throw new Error('Formatting configuration reader returned an invalid snapshot.');
        }

        result.snapshots.push(snapshot);
        return snapshot.text;
    },

    /** @description Resolves EditorConfig root, directory inheritance, selectors and unset before mapping preferences. */
    async editorConfig(directories, filePath, readSnapshot, result)
    {
        const files = [];
        for(const directory of directories)
        {
            const filename = path.join(directory, '.editorconfig');
            const text = await this.read(filename, readSnapshot, result);
            if(text !== null)
            {
                const parsed = LgdEditorConfig.parse(text, filename);
                files.unshift(parsed);
                if(parsed.root)
                {
                    break;
                }
            }
        }

        const resolved = LgdEditorConfig.resolve(files, { filePath: filePath });
        const mapped = LgdEditorConfig.map(resolved.properties);
        mapped.issues.unshift(...resolved.issues);
        return mapped;
    },

    /** @description Uses the nearest clang file unless it explicitly requests parent inheritance. */
    async clangFormat(directories, readSnapshot, result)
    {
        const layers = [];
        for(const directory of directories)
        {
            let parsed;
            for(const basename of [ '.clang-format', '_clang-format' ])
            {
                const filename = path.join(directory, basename);
                const text = await this.read(filename, readSnapshot, result);
                if(text !== null)
                {
                    parsed = LgdClangFormat.parse(text, filename);
                    layers.unshift(parsed);
                    break;
                }
            }

            if(parsed && !parsed.inheritParent)
            {
                break;
            }
        }

        const merged = { options: {}, rules: {}, issues: [] };
        for(const layer of layers)
        {
            this.merge(merged, layer);
        }

        return merged;
    },

    /** @description Imports legacy JSON ESLint rule data and scoped overrides without executing config JavaScript. */
    async eslint(directories, filePath, readSnapshot, result)
    {
        const layers = [];
        for(const directory of directories)
        {
            const filename = path.join(directory, '.eslintrc.json');
            const text = await this.read(filename, readSnapshot, result);
            if(text === null)
            {
                continue;
            }

            const layer = LgdEslintStyle.parse(text, filename);
            const relative = path.relative(directory, filePath).replaceAll(path.sep, '/');
            for(const override of layer.overrides)
            {
                const patterns = Array.isArray(override.files) ? override.files : [override.files];
                const excludes = Array.isArray(override.excludedFiles) ? override.excludedFiles : [override.excludedFiles];
                if(patterns.some(pattern => this.matchesOverride(pattern, relative, layer)) && !excludes.some(pattern => this.matchesOverride(pattern, relative, layer)))
                {
                    LgdEslintStyle.map(override.rules || {}, layer);
                }
            }

            layers.unshift(layer);
            if(layer.root)
            {
                break;
            }
        }

        const merged = { options: {}, rules: {}, issues: [] };
        for(const layer of layers)
        {
            this.merge(merged, layer);
        }

        return merged;
    },

    /** @description Refuses ESLint glob features whose meaning differs from the EditorConfig matcher. */
    matchesOverride(pattern, relative, layer)
    {
        if(typeof pattern !== 'string')
        {
            return false;
        }

        if((/[!()+@[\]\\]/u).test(pattern))
        {
            layer.issues.push(`ESLint override glob ${pattern} uses syntax outside the supported shared glob subset.`);
            return false;
        }

        return LgdEditorConfig.matches(pattern, relative);
    },

    /** @description Merges sparse style layers and independent severity overrides in deterministic source order. */
    merge(target, layer)
    {
        const checked = LgdFormattingOptions.validate(layer.options);
        target.options = LgdFormattingOptions.merge(target.options, checked.options);
        if(checked.issues.length > 0)
        {
            layer.disabled = true;
            layer.issues.push(...checked.issues.map(message => ({ message: message, severity: 'error' })));
        }

        target.rules = { ...target.rules, ...layer.rules };
        target.issues.push(...layer.issues.map(issue =>
        {
            if(typeof issue === 'string')
            {
                return { path: layer.filename || '', message: issue, severity: layer.disabled ? 'error' : 'warning' };
            }

            return { ...issue, path: issue.path || issue.filename || layer.filename || '', severity: issue.severity || 'warning' };
        }));

        target.disabled = layer.disabled ?? target.disabled;
    }
};

module.exports = LgdFormattingSources;
