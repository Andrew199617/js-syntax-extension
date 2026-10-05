const parser = require('@babel/parser');
const { maskCode } = require('./LgdInfer');

/** @description Reads explicit static module bindings without executing dependencies or guessing export names. */
const LgdModuleBindings = {
    /** @description Parses ordinary import and export clauses separately from LGD declarations. */
    clauses(content)
    {
        const masked = maskCode(content, true);
        const identifier = String.raw`[$A-Z_a-z][\w$]*`;
        const importBindings = String.raw`(?:${identifier}\s*(?:,\s*)?)?(?:\*\s+as\s+${identifier}\s*|{[^}]*}\s*)?from\s*`;
        const importClause = String.raw`import\s+(?:${importBindings})?["'][^\n\r"']*["']`;
        const exportClause = String.raw`export\s*{[^}]*}(?:\s*from\s*["'][^\n\r"']*["'])?`;
        const defaultClause = String.raw`export\s+default\s+${identifier}(?=\s*(?:;|$))`;
        const pattern = new RegExp(String.raw`\b(?:${importClause}|${exportClause}|${defaultClause})\s*;?`, 'g');
        const clauses = [];
        for(const match of content.matchAll(pattern))
        {
            if(!masked.startsWith(match[0].startsWith('import') ? 'import' : 'export', match.index))
            {
                continue;
            }

            try
            {
                const statement = parser.parse(match[0], { sourceType: 'module', allowUndeclaredExports: true }).program.body[0];
                clauses.push({ statement: statement, offset: match.index });
            }
            catch
            {
                // Unsupported or incomplete clauses retain ordinary unknown-binding behavior.
            }
        }

        return clauses;
    },

    /** @description Describes default, named, namespace and side-effect imports with their real local names. */
    imports(content)
    {
        const imports = [];
        for(const { statement, offset } of this.clauses(content))
        {
            if(statement.type !== 'ImportDeclaration')
            {
                continue;
            }

            for(const specifier of statement.specifiers)
            {
                let importedName = 'default';
                if(specifier.type === 'ImportNamespaceSpecifier')
                {
                    importedName = '*';
                }
                else if(specifier.type === 'ImportSpecifier')
                {
                    importedName = specifier.imported.name || specifier.imported.value;
                }

                imports.push({ name: specifier.local.name, importedName: importedName, spec: statement.source.value,
                    offset: offset, nameStart: offset + specifier.local.start });
            }
        }

        return imports;
    },

    /** @description Finds only explicitly declared exports, including CommonJS default interop and explicit re-exports. */
    exports(content, declarations)
    {
        const exports = new Map();
        for(const declaration of declarations)
        {
            if(declaration.exported)
            {
                exports.set(declaration.name, { name: declaration.name });
            }
        }

        for(const [ name, reference ] of this.commonJsExports(content))
        {
            exports.set(name, reference);
        }

        for(const { statement } of this.clauses(content))
        {
            if(statement.type === 'ExportDefaultDeclaration' && statement.declaration.type === 'Identifier')
            {
                exports.set('default', { name: statement.declaration.name });
            }
            else if(statement.type === 'ExportNamedDeclaration')
            {
                for(const specifier of statement.specifiers)
                {
                    const name = specifier.exported.name || specifier.exported.value;
                    exports.set(name, { name: specifier.local.name || specifier.local.value, spec: statement.source?.value });
                }
            }
        }

        return exports;
    },

    /** @description Distinguishes ESM namespaces from direct CommonJS constructor exports. */
    moduleKind(content, declarations)
    {
        return declarations.some(declaration => declaration.exported) || this.clauses(content).length > 0 ? 'esm' : 'commonjs';
    },

    /** @description Restricts CommonJS export evidence to stable top-level assignments. */
    commonJsExports(content)
    {
        const exports = new Map();
        const masked = maskCode(content, true);
        const shadowed = /\b(?:const|let|var|function|class)\s+(?:module|exports)\b/;
        if(shadowed.test(masked))
        {
            return exports;
        }

        const assignment = /\b(?:module\.exports|exports)(?:\.[$A-Z_a-z][\w$]*)?\s*=\s*[^;]*;?/g;
        const provenTargets = [];
        let cursor = 0;
        let depth = 0;
        for(const match of content.matchAll(assignment))
        {
            for(; cursor < match.index; cursor++)
            {
                if('({['.includes(masked[cursor]))
                {
                    depth++;
                }
                else if(')}]'.includes(masked[cursor]))
                {
                    depth--;
                }
            }

            const prefix = masked.slice(0, match.index).trimEnd();
            const statementStart = prefix.length === 0 || [ ';', '}' ].includes(prefix.at(-1));
            const target = match[0].startsWith('module') ? 'module' : 'exports';
            if(depth !== 0 || !statementStart || !masked.startsWith(target, match.index))
            {
                continue;
            }

            let expression;
            try
            {
                expression = parser.parse(match[0]).program.body[0].expression;
            }
            catch
            {
                exports.clear();
                continue;
            }

            provenTargets.push({ start: match.index, end: match.index + expression.left.end });
            this.recordCommonJsExport(exports, expression);
        }

        const references = [...masked.matchAll(/(?:^|[^\w$.])(?<name>module|exports)\b/g)];
        const unprovenReference = references.some(reference =>
        {
            const offset = reference.index + reference[0].length - reference.groups.name.length;
            return !provenTargets.some(target => target.start <= offset && offset < target.end);
        });

        return unprovenReference ? new Map() : exports;
    },

    /** @description Records complete simple export objects and invalidates replaced or dynamic exports. */
    recordCommonJsExport(exports, expression)
    {
        const left = expression.left;
        const right = expression.right;
        const moduleReceiver = left.type === 'MemberExpression' && left.object.type === 'Identifier' && left.object.name === 'module';
        const directModule = moduleReceiver && left.property.name === 'exports';
        if(directModule)
        {
            exports.clear();
            if(right.type === 'Identifier')
            {
                exports.set('default', { name: right.name });
            }
            else if(right.type === 'ObjectExpression')
            {
                const simple = right.properties.every(property => property.type === 'ObjectProperty' && !property.computed && property.value.type === 'Identifier');

                if(simple)
                {
                    for(const property of right.properties)
                    {
                        const name = property.key.name ?? String(property.key.value);
                        exports.set(name, { name: property.value.name, commonJsProperty: true });
                    }
                }
            }
        }
        else if(left.type === 'MemberExpression' && !left.computed)
        {
            exports.delete(left.property.name);
            if(right.type === 'Identifier')
            {
                exports.set(left.property.name, { name: right.name, commonJsProperty: true });
            }
        }
    },

    /** @description Resolves the actual value of a require call, including ESM and named CommonJS namespaces. */
    required(externals, spec)
    {
        const external = externals.get(spec);
        if(external && external.moduleKind !== 'esm' && !external.commonJsProperty)
        {
            return external;
        }

        const exports = externals.moduleExports?.get(spec);
        return exports?.size > 0 ? this.external(externals, spec, '*') : null;
    },

    /** @description Resolves an explicit import selector while keeping namespace objects distinct from classes. */
    external(externals, spec, importedName = 'default')
    {
        if(importedName === '*')
        {
            return { kind: 'moduleNamespace', typeName: 'Object', moduleExports: externals.moduleExports?.get(spec) || new Map() };
        }

        const external = externals.moduleExports?.get(spec)?.get(importedName) || (importedName === 'default' ? externals.get(spec) : null) || null;
        if(importedName === 'default' && (!external || external.commonJsProperty))
        {
            const exports = externals.moduleExports?.get(spec);
            const commonJs = exports?.size > 0 && [...exports.values()].every(entry => entry.moduleKind === 'commonjs' && entry.commonJsProperty);
            return commonJs ? this.external(externals, spec, '*') : null;
        }

        return external;
    },

    /** @description Looks up a module import through the parsed JavaScript binding used by type and member checking. */
    forBinding(binding, externals)
    {
        const specifier = binding.path.node;
        if(!binding.path.isImportSpecifier() && !binding.path.isImportDefaultSpecifier() && !binding.path.isImportNamespaceSpecifier())
        {
            return null;
        }

        const source = binding.path.parent.source.value;
        const imported = specifier.imported?.name || specifier.imported?.value;
        const name = binding.path.isImportNamespaceSpecifier() ? '*' : imported || 'default';
        return this.external(externals, source, name);
    },

    /** @description Includes named exports in source-backed type graphs without changing legacy default map entries. */
    values(externals)
    {
        const values = new Set(externals.values());
        for(const exports of externals.moduleExports?.values() || [])
        {
            for(const declaration of exports.values())
            {
                values.add(declaration);
            }
        }

        return [...values];
    }
};

module.exports = LgdModuleBindings;
