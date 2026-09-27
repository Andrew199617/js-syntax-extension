// Resolve source and output paths for the extension build.
const path = require('path');

// Copy assets into the distributable extension directory.
const fs = require('node:fs/promises');

// Use the existing extension manifest as the source of package metadata.
const extensionManifest = require('./package.json');

/** @import { Configuration } from 'webpack' */

async function writeManifest(fileName, manifest)
{
    const contents = `${JSON.stringify(manifest, null, 2)}\n`.replaceAll('\n', '\r\n');
    await fs.writeFile(fileName, contents);
}

async function copyAsset(source, destination)
{
    const sourceStats = await fs.stat(source);
    if(sourceStats.isDirectory())
    {
        // Create fresh directories without copying Windows read-only attributes.
        await fs.mkdir(destination, { recursive: true });
        for(const entry of await fs.readdir(source))
        {
            await copyAsset(path.join(source, entry), path.join(destination, entry));
        }

        return;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
}

async function prepareExtensionOutput(compilation)
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
    await writeManifest(path.join(target, 'package.json'), pluginManifest);

    // Application dependencies are bundled in extension.js; tsserver loads its own module.
    const outputManifest = {
        ...extensionManifest,
        main: `./${path.basename(extensionManifest.main)}`,
        dependencies: { [pluginName]: extensionManifest.version }
    };
    delete outputManifest.scripts;
    delete outputManifest.devDependencies;
    delete outputManifest.imports;
    await writeManifest(path.join(output, 'package.json'), outputManifest);

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

    for(const asset of assets)
    {
        const destination = path.join(output, asset);
        await copyAsset(path.join(__dirname, asset), destination);
    }
}

// TypeScript loads this module in tsserver, separately from LGD.js in the extension host.
const extensionOutput = {
    /** @description Registers the post-build step that prepares the extension output. */
    apply(compiler)
    {
        compiler.hooks.afterEmit.tapPromise('PrepareExtensionOutput', prepareExtensionOutput);
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
        vscode: 'commonjs vscode'
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
