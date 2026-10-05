// Resolve source and output paths for the extension build.
const path = require('path');

// Copy assets into the distributable extension directory.
const fs = require('node:fs/promises');

// Use the existing extension manifest as the source of package metadata.
const extensionManifest = require('./package.json');

/** @import { Compiler, Configuration } from 'webpack' */

// TypeScript loads this module in tsserver, separately from LGD.js in the extension host.
const extensionOutput = {
    /**
     * @description Registers asset and manifest preparation after webpack emits the extension bundle.
     * @param {Compiler} compiler Webpack compiler that owns the build hooks.
     */
    apply(compiler)
    {
        const prepareOutput = this.prepareExtensionOutput.bind(this);
        compiler.hooks.afterEmit.tapPromise('PrepareExtensionOutput', prepareOutput);
    },

    /** @description Writes a formatted package manifest with CRLF line endings. */
    async writeManifest(fileName, manifest)
    {
        const contents = `${JSON.stringify(manifest, null, 2)}\n`.replaceAll('\n', '\r\n');
        await fs.writeFile(fileName, contents);
    },

    /** @description Copies an asset or directory tree without preserving read-only directory attributes. */
    async copyAsset(source, destination)
    {
        const sourceStats = await fs.stat(source);
        if(sourceStats.isDirectory())
        {
            // Create fresh directories without copying Windows read-only attributes.
            await fs.mkdir(destination, { recursive: true });
            for(const entry of await fs.readdir(source))
            {
                await this.copyAsset(path.join(source, entry), path.join(destination, entry));
            }

            return;
        }

        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
    },

    /** @description Ships the checker runtime and standard declarations without bundling unused server/CLI runtimes. */
    async copyTypescriptRuntime(source, output)
    {
        for(const filename of await fs.readdir(path.join(source, 'lib')))
        {
            if(filename === 'typescript.js' || filename.startsWith('lib.') && filename.endsWith('.d.ts'))
            {
                await this.copyAsset(path.join(source, 'lib', filename), path.join(output, 'node_modules/typescript/lib', filename));
            }
        }
    },

    /** @description Adds the TypeScript server plugin, package manifest, and extension assets to the build output. */
    async prepareExtensionOutput(compilation)
    {
        const output = compilation.outputOptions.path;
        const pluginName = extensionManifest.contributes.typescriptServerPlugins[0].name;
        const target = path.join(output, 'node_modules', pluginName);
        const source = path.join(__dirname, 'src/SemanticHighlighting/CallbackParameters.js');
        const pluginManifest = {
            name: pluginName,
            version: extensionManifest.version,
            private: true,
            main: 'index.js'
        };
        await fs.mkdir(target, { recursive: true });
        await fs.copyFile(source, path.join(target, 'index.js'));
        await this.writeManifest(path.join(target, 'package.json'), pluginManifest);
        const typescriptSource = path.dirname(require.resolve('typescript/package.json'));
        await this.copyTypescriptRuntime(typescriptSource, output);
        await this.copyAsset(path.join(typescriptSource, 'package.json'), path.join(output, 'node_modules/typescript/package.json'));
        await this.copyAsset(path.join(typescriptSource, 'LICENSE.txt'), path.join(output, 'node_modules/typescript/LICENSE.txt'));
        await this.copyAsset(path.join(typescriptSource, 'ThirdPartyNoticeText.txt'), path.join(output, 'node_modules/typescript/ThirdPartyNoticeText.txt'));

        // Application dependencies are bundled in extension.js; tsserver loads its own module.
        const outputManifest = {
            ...extensionManifest,
            main: `./${path.basename(extensionManifest.main)}`,
            dependencies: { [pluginName]: extensionManifest.version, typescript: extensionManifest.dependencies.typescript }
        };
        delete outputManifest.scripts;
        delete outputManifest.devDependencies;
        delete outputManifest.imports;
        await this.writeManifest(path.join(output, 'package.json'), outputManifest);

        const assets = new Set([
            'README.md',
            'CHANGELOG.md',
            'LICENSE',
            'language-configuration.json',
            '.vscodeignore',
            'images',
            extensionManifest.icon
        ]);
        for(const grammar of extensionManifest.contributes.grammars)
        {
            assets.add(grammar.path);
        }

        for(const validation of extensionManifest.contributes.jsonValidation || [])
        {
            if(validation.url.startsWith('./'))
            {
                assets.add(validation.url);
            }
        }

        for(const asset of assets)
        {
            const destination = path.join(output, asset);
            await this.copyAsset(path.join(__dirname, asset), destination);
        }
    }
};

/** @type {Configuration} */
const config = {
    target: 'node',
    entry: './src/LGD.js',
    output: {
        path: path.resolve(__dirname, path.dirname(extensionManifest.main)),
        filename: path.basename(extensionManifest.main),
        clean: true,
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'source-map',
    plugins: [extensionOutput],
    externals: {
        vscode: 'commonjs vscode',
        typescript: 'commonjs typescript'
    },
    resolve: {
        mainFields: [ 'browser', 'module', 'main' ],
        extensions: [ '.ts', '.js' ],
        alias: {
            SRC: path.resolve(__dirname, 'src')
        },
        fallback: {
            path: require.resolve('path-browserify')
        }
    }
};

module.exports = config;
