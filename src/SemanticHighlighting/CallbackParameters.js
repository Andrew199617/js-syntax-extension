const path = require('path');

// TypeScript's 2020 semantic encoding; verified on TS 5.0, 5.9 and 6.0.
// Keep this independent of a bundled TypeScript: the server supplies its own instance.
const encoding = Object.freeze({
    typeOffset: 8,
    modifierMask: 255,
    functionType: 10,
    parameterType: 6,
    spanSize: 3,
    firstSupportedMajor: 5,
    lastSupportedMajor: 6
});

/**
 * @description Reads the original file path attached only to an LGD in-memory mirror.
 * @param {Object} source the containing TypeScript source file.
 * @returns {string|null} the original absolute source path when present.
 */
function lgdSourcePath(source)
{
    if(!source || !source.fileName.startsWith('^/untitled/'))
    {
        return null;
    }

    const marker = (/(?:^|\r?\n)\/\/# lgd-source=(?<sourcePath>"[^\n\r]*")\s*$/).exec(source.text);
    if(!marker)
    {
        return null;
    }

    try
    {
        const fileName = JSON.parse(marker.groups.sourcePath);
        return path.isAbsolute(fileName) ? fileName : null;
    }
    catch
    {
        return null;
    }
}

/**
 * @description Resolves LGD mirror imports from their original source directory and project settings.
 * @param {Object} info the TypeScript plugin context.
 * @param {Object} typescript the TypeScript implementation supplied by the server.
 */
function installLgdModuleResolution(info, typescript)
{
    const host = info.languageServiceHost;
    if(!host)
    {
        return;
    }

    const original = host.resolveModuleNameLiterals;
    host.resolveModuleNameLiterals = (...args) =>
    {
        const [ literals, containingFile, redirectedReference, options, source ] = args;
        const originalPath = lgdSourcePath(source);
        if(!originalPath && original)
        {
            return original.apply(host, args);
        }

        let settings = options;
        if(originalPath)
        {
            const directory = path.dirname(originalPath);
            const configurations = [ 'tsconfig.json', 'jsconfig.json' ]
                .map(name => typescript.findConfigFile(directory, typescript.sys.fileExists, name))
                .filter(Boolean)
                .sort((first, second) => path.dirname(second).length - path.dirname(first).length);
            const configuration = configurations[0];
            if(configuration)
            {
                const parsed = typescript.readConfigFile(configuration, typescript.sys.readFile);
                if(!parsed.error)
                {
                    const project = typescript.parseJsonConfigFileContent(parsed.config, typescript.sys, path.dirname(configuration));
                    settings = { ...options, ...project.options };
                }
            }
        }

        return literals.map(literal => typescript.resolveModuleName(
            literal.text,
            originalPath || containingFile,
            settings,
            typescript.sys,
            undefined,
            redirectedReference,
            typescript.getModeForUsageLocation(source, literal, settings)
        ));
    };
}

function init(modules)
{
    const typescript = modules.typescript;
    const major = Number(typescript.versionMajorMinor.split('.')[0]);

    function isParameterBinding(declaration)
    {
        let current = declaration;
        while(typescript.isBindingElement(current))
        {
            const pattern = current.parent;
            if(!typescript.isObjectBindingPattern(pattern) && !typescript.isArrayBindingPattern(pattern))
            {
                return false;
            }

            current = pattern.parent;
            if(current.name !== pattern)
            {
                return false;
            }
        }

        return typescript.isParameter(current);
    }

    function correct(service, fileName, result)
    {
        const candidates = new Map();
        const spans = result.spans;
        let first = Infinity;
        let last = -1;
        for(let index = 0; index < spans.length; index += encoding.spanSize)
        {
            const classification = spans[index + 2];
            if((classification >> encoding.typeOffset) - 1 === encoding.functionType)
            {
                const start = spans[index];
                const length = spans[index + 1];
                candidates.set(start, { index: index, length: length });
                first = Math.min(first, start);
                last = Math.max(last, start + length);
            }
        }

        if(candidates.size === 0)
        {
            return result;
        }

        const program = service.getProgram();
        const source = program && program.getSourceFile(fileName);
        if(!source || source.scriptKind !== typescript.ScriptKind.JS && source.scriptKind !== typescript.ScriptKind.JSX)
        {
            return result;
        }

        const checker = program.getTypeChecker();
        const bindings = new Map();
        let adjusted;

        function visit(node)
        {
            // Traverse the relevant subtrees once, never rescan the file for each token.
            if(node.end <= first || node.pos >= last)
            {
                return;
            }

            if(typescript.isIdentifier(node))
            {
                const start = node.getStart(source);
                const candidate = candidates.get(start);
                if(!candidate || node.end - start !== candidate.length)
                {
                    return;
                }

                const symbol = checker.getSymbolAtLocation(node);
                if(!symbol)
                {
                    return;
                }

                if(!bindings.has(symbol))
                {
                    bindings.set(symbol, !!symbol.declarations && symbol.declarations.some(isParameterBinding));
                }

                if(bindings.get(symbol))
                {
                    adjusted = adjusted || spans.slice();
                    const index = candidate.index + 2;
                    adjusted[index] = encoding.parameterType + 1 << encoding.typeOffset
            | spans[index] & encoding.modifierMask;
                }

                return;
            }

            typescript.forEachChild(node, visit);
        }

        visit(source);
        return adjusted ? { ...result, spans: adjusted } : result;
    }

    return {
        /** @description Wraps a supported TypeScript language service with callback-parameter highlighting. */
        create(info)
        {
            const service = info.languageService;
            if(major < encoding.firstSupportedMajor || major > encoding.lastSupportedMajor || !Number.isInteger(major))
            {
                return service;
            }

            installLgdModuleResolution(info, typescript);

            const proxy = Object.create(null);
            for(const key of Object.keys(service))
            {
                const value = service[key];
                proxy[key] = typeof value === 'function' ? value.bind(service) : value;
            }

            const logger = info.project.projectService.logger;
            logger.info(`[callback-parameters] plugin loaded (TypeScript ${typescript.version})`);
            let loggedRequest = false;
            proxy.getEncodedSemanticClassifications = (...args) =>
            {
                const result = service.getEncodedSemanticClassifications(...args);
                if(args[2] !== typescript.SemanticClassificationFormat.TwentyTwenty && args[2] !== '2020')
                {
                    return result;
                }

                if(!loggedRequest)
                {
                    logger.info('[callback-parameters] semantic request intercepted');
                    loggedRequest = true;
                }

                return correct(service, args[0], result);
            };

            return proxy;
        }
    };
}

module.exports = init;
