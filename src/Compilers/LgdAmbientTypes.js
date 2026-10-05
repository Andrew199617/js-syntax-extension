const path = require('path');
const { parseTypeName } = require('./LgdTypeMaps');

/** @description Caps distinct project/library/import checker snapshots retained by the extension. */
const registryLimit = 8;

/** @description Reuses TypeScript library symbols for known ambient annotations and native member results. */
const LgdAmbientTypes = {
    /** @description Lazily creates and caches a library-only checker for the source project's configured libraries. */
    forSource(sourcePath = null, imports = [])
    {
        this._typescript ||= require('typescript');
        this._registries ||= new Map();
        const typescript = this._typescript;
        const options = this._options(sourcePath);
        const source = this._importSource(imports);
        const directory = sourcePath ? path.dirname(sourcePath) : path.dirname(typescript.getDefaultLibFilePath(options));
        const filename = path.join(directory, '__lgd_ambient__.ts');
        const modules = imports.map(imported => typescript.resolveModuleName(imported.spec, filename, options, typescript.sys).resolvedModule);
        const key = JSON.stringify({ options: options, directory: imports.length > 0 || options.types.length > 0 ? directory : null, source: source, modules: modules });
        const cached = this._registries.get(key);
        if(cached && cached._dependenciesCurrent())
        {
            return cached;
        }

        const registry = Object.create(this);
        registry._typescript = typescript;
        const host = typescript.createCompilerHost(options);
        const readSource = host.getSourceFile.bind(host);

        // TypeScript normalizes Windows separators before invoking the compiler host.
        function canonicalFilename(name)
        {
            return host.getCanonicalFileName(name.replaceAll('\\', '/'));
        }

        const virtualFilename = canonicalFilename(filename);
        host.getSourceFile = (name, languageVersion, ...remaining) =>
        {
            if(canonicalFilename(name) === virtualFilename)
            {
                return typescript.createSourceFile(name, source, languageVersion, true);
            }

            return readSource(name, languageVersion, ...remaining);
        };

        registry._program = typescript.createProgram([filename], options, host);
        registry._checker = registry._program.getTypeChecker();
        registry._source = registry._program.getSourceFile(filename);
        const symbolKinds = typescript.SymbolFlags.Type | typescript.SymbolFlags.Namespace | typescript.SymbolFlags.Alias;
        registry._symbols = new Map(registry._checker.getSymbolsInScope(registry._source, symbolKinds)
            .filter(symbol => !symbol.name.startsWith('__'))
            .map(symbol => [ symbol.name, symbol ]));
        registry._returns = new Map();
        registry._dependencies = new Map(registry._program.getSourceFiles()
            .filter(file => !registry._program.isSourceFileDefaultLibrary(file) && canonicalFilename(file.fileName) !== virtualFilename)
            .map(file => [ file.fileName, typescript.sys.getModifiedTime(file.fileName)?.getTime() ]));
        this._registries.set(key, registry);
        if(this._registries.size > registryLimit) this._registries.delete(this._registries.keys().next().value);
        return registry;
    },

    _options(sourcePath)
    {
        const typescript = this._typescript;
        let configured = {};
        let hasConfig = false;
        if(sourcePath)
        {
            const directory = path.dirname(sourcePath);
            const tsconfig = typescript.findConfigFile(directory, typescript.sys.fileExists, 'tsconfig.json');
            const jsconfig = typescript.findConfigFile(directory, typescript.sys.fileExists, 'jsconfig.json');
            const nearestJsconfig = jsconfig && (!tsconfig || path.dirname(jsconfig).length > path.dirname(tsconfig).length);
            const config = nearestJsconfig ? jsconfig : tsconfig;
            if(config)
            {
                const read = typescript.readConfigFile(config, typescript.sys.readFile);
                if(!read.error)
                {
                    const host = { ...typescript.sys, readDirectory: () => [] };
                    const converted = typescript.parseJsonConfigFileContent(read.config, host, path.dirname(config), {}, config);
                    configured = converted.options;
                    hasConfig = true;
                }
            }
        }

        // Standalone LGD sources have ECMAScript globals without inventing a browser environment.
        const defaultTarget = hasConfig ? typescript.ScriptTarget.ES5 : typescript.ScriptTarget.ES2022;
        const target = configured.target ?? defaultTarget;
        let ecma = typescript.ScriptTarget[target].toLowerCase();
        if(target >= typescript.ScriptTarget.ESNext) ecma = 'esnext';
        else if(target <= typescript.ScriptTarget.ES5) ecma = 'es5';
        const targetLib = typescript.libMap.get(ecma);
        return { ...configured, target: target,
            lib: configured.lib || [targetLib], noLib: Boolean(configured.noLib),
            strictNullChecks: true, skipLibCheck: true, noEmit: true, allowJs: true, types: configured.types || [] };
    },

    _importSource(imports)
    {
        const declarations = imports.map(imported =>
        {
            const spec = JSON.stringify(imported.spec);
            if(imported.importedName === '*')
            {
                return `import * as ${imported.name} from ${spec};`;
            }

            if(imported.importedName === 'default')
            {
                return `import ${imported.name} from ${spec};`;
            }

            return `import { ${imported.importedName} as ${imported.name} } from ${spec};`;
        });

        return `${declarations.join('\n')}\nexport {};`;
    },

    _dependenciesCurrent()
    {
        return [...this._dependencies].every(([ filename, modified ]) => this._typescript.sys.getModifiedTime(filename)?.getTime() === modified);
    },

    _unalias(symbol)
    {
        return symbol?.flags & this._typescript.SymbolFlags.Alias ? this._checker.getAliasedSymbol(symbol) : symbol;
    },

    _symbol(name)
    {
        const parts = name.split('.');
        let symbol = this._unalias(this._symbols.get(parts.shift()));
        for(const part of parts)
        {
            symbol = symbol && this._unalias(this._checker.getExportsOfModule(symbol).find(candidate => candidate.name === part));
        }

        return symbol;
    },

    /** @description Resolves an ambient type or namespace without treating ordinary global values as types. */
    resolve(name)
    {
        const symbol = this._symbol(name);

        if(!symbol || !(symbol.flags & this._typescript.SymbolFlags.Type))
        {
            return null;
        }

        return { name: name, kind: this._kind(symbol) };
    },

    _kind(symbol)
    {
        const flags = this._typescript.SymbolFlags;
        if(symbol.flags & flags.Class)
        {
            return 'class';
        }

        if(symbol.flags & flags.Interface)
        {
            return 'interface';
        }

        if(symbol.flags & flags.Enum)
        {
            return 'enum';
        }

        if(symbol.flags & flags.Namespace)
        {
            return 'module';
        }

        return 'typeAlias';
    },

    /** @description Lists type-space names, including a namespace only when it exposes types. */
    completions(qualifier = '')
    {
        let symbols = [...this._symbols.values()];
        if(qualifier)
        {
            const namespace = this._symbol(qualifier);
            symbols = namespace ? this._checker.getExportsOfModule(namespace) : [];
        }

        const flags = this._typescript.SymbolFlags;
        return symbols.filter(original =>
        {
            const symbol = this._unalias(original);
            const namespace = symbol.flags & flags.Namespace && this._checker.getExportsOfModule(symbol).some(member => member.flags & flags.Type);
            return symbol.flags & flags.Type || namespace;
        })
            .map(symbol => ({ name: symbol.name, kind: this._kind(this._unalias(symbol)) }));
    },

    /** @description Returns every supported overload result, keeping null and uncertainty separate. */
    memberReturnTypes(receiverType, methodName, argumentTypes = null)
    {
        const key = `${receiverType}.${methodName}:${JSON.stringify(argumentTypes)}`;
        if(this._returns.has(key))
        {
            return this._returns.get(key);
        }

        const symbol = this._symbol(receiverType);
        const receiver = symbol && this._checker.getDeclaredTypeOfSymbol(symbol);
        const member = receiver && this._checker.getPropertyOfType(receiver, methodName);
        const type = member && this._checker.getTypeOfSymbolAtLocation(member, member.valueDeclaration || member.declarations[0]);
        const available = type ? this._checker.getSignaturesOfType(type, this._typescript.SignatureKind.Call) : [];
        const signatures = available.filter(signature => argumentTypes === null || this._acceptsArguments(signature, argumentTypes));
        let result = null;
        if(signatures.length > 0 && signatures.every(signature => !signature.typeParameters?.length))
        {
            const returns = signatures.flatMap(signature => this._typeNames(this._checker.getReturnTypeOfSignature(signature)));
            if(returns.length > 0 && !returns.includes('Unknown'))
            {
                result = [...new Set(returns)];
            }
        }

        this._returns.set(key, result);
        return result;
    },

    _acceptsArguments(signature, argumentsTypes)
    {
        const parameters = signature.getParameters();
        const minimum = parameters.filter(parameter =>
        {
            const declaration = parameter.valueDeclaration;
            return declaration && !declaration.questionToken && !declaration.initializer && !declaration.dotDotDotToken;
        }).length;

        const variadic = parameters.some(parameter => parameter.valueDeclaration?.dotDotDotToken);
        const tooMany = !variadic && argumentsTypes.length > parameters.length;
        if(argumentsTypes.length < minimum || tooMany)
        {
            return false;
        }

        return argumentsTypes.every((names, index) =>
        {
            const parameter = parameters[index];
            if(!parameter || parameter.valueDeclaration?.dotDotDotToken)
            {
                return false;
            }

            const expected = this._checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration);
            if(names.length === 0)
            {
                return false;
            }

            return names.every(name =>
            {
                const actual = this._argumentType(name);
                return actual && this._checker.isTypeAssignableTo(actual, expected);
            });
        });
    },

    _argumentType(name)
    {
        const checker = this._checker;
        const primitives = { String: () => checker.getStringType(), Number: () => checker.getNumberType(),
            Boolean: () => checker.getBooleanType(), BigInt: () => checker.getBigIntType(),
            null: () => checker.getNullType(), undefined: () => checker.getUndefinedType() };
        if(primitives[name])
        {
            return primitives[name]();
        }

        const symbol = this._symbol(name);
        return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : null;
    },

    /** @description Uses TypeScript's established nominal and structural relationships for two known ambient types. */
    assignable(declared, inferred)
    {
        const expected = this._annotationType(declared);
        const actual = this._annotationType(inferred);
        if(!expected || !actual)
        {
            return null;
        }

        return this._checker.isTypeAssignableTo(actual, expected);
    },

    _annotationType(name)
    {
        const parsed = parseTypeName(name);
        return parsed ? this._annotationNodeType(parsed.annotation) : null;
    },

    _annotationNodeType(annotation)
    {
        if(annotation.kind === 'named')
        {
            return this._argumentType(annotation.name);
        }

        const element = this._annotationNodeType(annotation.element);
        if(!element)
        {
            return null;
        }

        if(annotation.kind === 'array')
        {
            return this._checker.createArrayType(element);
        }

        return this._checker.getUnionType([ element, this._checker.getNullType() ]);
    },

    _typeNames(type)
    {
        const flags = this._typescript.TypeFlags;
        if(type.isUnion())
        {
            return type.types.flatMap(member => this._typeNames(member));
        }

        if(type.flags & flags.StringLike)
        {
            return ['String'];
        }

        if(type.flags & flags.NumberLike)
        {
            return ['Number'];
        }

        if(type.flags & flags.BooleanLike)
        {
            return ['Boolean'];
        }

        if(type.flags & flags.BigIntLike)
        {
            return ['BigInt'];
        }

        if(type.flags & flags.ESSymbolLike)
        {
            return ['Symbol'];
        }

        if(type.flags & flags.Null)
        {
            return ['null'];
        }

        if(type.flags & (flags.Undefined | flags.Void))
        {
            return ['undefined'];
        }

        if(this._checker.isArrayType(type))
        {
            const element = this._checker.getTypeArguments(type)[0];
            const names = element && this._typeNames(element);
            if(names?.length === 1 && names[0] !== 'Unknown')
            {
                return [`${names[0]}[]`];
            }

            return ['Unknown'];
        }

        const symbol = type.aliasSymbol || type.getSymbol();
        const name = symbol?.name;
        const generic = type.typeArguments?.length > 0 || type.aliasTypeArguments?.length > 0;
        return name && !generic && this.resolve(name) ? [name] : ['Unknown'];
    }
};

module.exports = LgdAmbientTypes;
