const traverse = require('@babel/traverse').default;
const LgdModuleBindings = require('./LgdModuleBindings');
const LgdSourceMap = require('./LgdSourceMap');
const LgdOutputOptions = require('./LgdOutputOptions');
const { collectContractBindings } = require('./LgdContractBindings');
const { visibleBindings } = require('./LgdBaseChecker');
const { maskCode } = require('./LgdInfer');

/** @description Lowers construction only for lexically proven LGD prototype factories. */
const LgdConstructionLowering = {
    /** @description Marks local classes with their actual chosen JavaScript construction model. */
    prepare(declarations, options)
    {
        const kind = LgdOutputOptions.constructionKind(options);
        for(const declaration of declarations.filter(candidate => candidate.kind === 'class'))
        {
            declaration.constructionKind = kind;
        }

        return kind;
    },

    /** @description Reports established mixed-backend ancestry rather than pretending allocation fixes inheritance. */
    checkInheritance(content, declarations, externals)
    {
        const derived = declarations.filter(declaration => declaration.kind === 'class' && declaration.baseName);
        if(derived.length === 0)
        {
            return [];
        }

        const bindings = collectContractBindings(content, declarations, externals);
        const errors = [];
        for(const declaration of derived)
        {
            const base = visibleBindings(bindings, declaration.headStart).get(declaration.baseName);
            const known = base?.kind === 'class' && base.constructionKind && declaration.constructionKind;
            if(known && base.constructionKind !== declaration.constructionKind)
            {
                errors.push({ offset: declaration.baseStart, endOffset: declaration.baseEnd, code: 'lgd.output.mixedBase',
                    message: `Class '${declaration.name}' and base '${declaration.baseName}' use incompatible JavaScript object models. Compile this class hierarchy with the same object model.` });
            }
        }

        return errors;
    },

    /** @description Resolves an unchanged binding without inferring construction from a name or annotation. */
    binding(binding, context, visited)
    {
        if(!binding.constant || visited.has(binding))
        {
            return null;
        }

        const next = new Set(visited);
        next.add(binding);
        const offset = context.map.toSource(binding.identifier.start);
        const local = context.declarations.get(offset);
        if(local)
        {
            return local;
        }

        const imported = LgdModuleBindings.forBinding(binding, context.externals);
        if(imported)
        {
            return imported;
        }

        if(!binding.path.isVariableDeclarator() || !binding.path.node.init)
        {
            return null;
        }

        const initializer = binding.path.get('init');
        if(binding.path.node.id.type === 'Identifier')
        {
            return this.resolve(initializer, context, next);
        }

        const pattern = binding.path.get('id');
        if(!pattern.isObjectPattern())
        {
            return null;
        }

        const property = pattern.get('properties').find(candidate =>
        {
            const value = candidate.node.value;
            return candidate.isObjectProperty() && value.type === 'Identifier' && value.name === binding.identifier.name;
        });

        const namespace = this.namespace(initializer, context, next);
        const name = property && this.memberName(property.node);
        return namespace?.moduleExports.get(name) || null;
    },

    /** @description Accepts only static property names, retaining computed expressions as unknown. */
    memberName(node)
    {
        if(!node.computed && node.key)
        {
            return node.key.name ?? String(node.key.value);
        }

        if(!node.computed)
        {
            return node.property.name;
        }

        const property = node.key || node.property;
        const literal = property.type === 'StringLiteral' || property.type === 'NumericLiteral';
        return literal ? String(property.value) : null;
    },

    /** @description Recognizes a static, unshadowed CommonJS import without executing it. */
    requireSpec(path)
    {
        const directRequire = path.isCallExpression() && path.get('callee').isIdentifier({ name: 'require' }) && !path.scope.getBinding('require');
        if(!directRequire || path.node.arguments.length !== 1 || path.node.arguments[0].type !== 'StringLiteral')
        {
            return null;
        }

        return path.node.arguments[0].value;
    },

    /** @description Keeps module namespaces distinct from their default class export. */
    namespace(path, context, visited)
    {
        const spec = this.requireSpec(path);
        if(spec !== null)
        {
            const exports = context.externals.moduleExports?.get(spec);
            return exports ? { kind: 'moduleNamespace', moduleExports: exports } : null;
        }

        if(path.isIdentifier())
        {
            const binding = path.scope.getBinding(path.node.name);
            if(!binding || !this.stableNamespace(binding))
            {
                return null;
            }
        }

        const resolved = this.resolve(path, context, visited);
        return resolved?.kind === 'moduleNamespace' ? resolved : null;
    },

    /** @description Rejects mutated or escaped CommonJS namespaces and their aliases. */
    stableNamespace(binding, visited = new Set())
    {
        if(!binding.constant || visited.has(binding))
        {
            return false;
        }

        if(binding.path.isImportNamespaceSpecifier())
        {
            return true;
        }

        const next = new Set(visited);
        next.add(binding);
        return binding.referencePaths.every(reference =>
        {
            const parent = reference.parentPath;
            if(parent.isVariableDeclarator() && parent.node.init === reference.node && parent.node.id.type === 'Identifier')
            {
                const alias = parent.scope.getBinding(parent.node.id.name);
                return alias && this.stableNamespace(alias, next);
            }

            if(!parent.isMemberExpression() || parent.node.object !== reference.node)
            {
                return false;
            }

            const owner = parent.parentPath;
            const write = owner.isAssignmentExpression() && owner.node.left === parent.node;
            return !write && !owner.isUpdateExpression() && !owner.isUnaryExpression({ operator: 'delete' });
        });
    },

    /** @description Resolves class values and immutable aliases through explicit import metadata. */
    resolve(path, context, visited = new Set())
    {
        if(path.findParent(parent => parent.isWithStatement()))
        {
            return null;
        }

        if(path.isIdentifier())
        {
            const binding = path.scope.getBinding(path.node.name);
            return binding ? this.binding(binding, context, visited) : null;
        }

        const spec = this.requireSpec(path);
        if(spec !== null)
        {
            return LgdModuleBindings.required(context.externals, spec);
        }

        if(path.isMemberExpression())
        {
            const namespace = this.namespace(path.get('object'), context, visited);
            return namespace?.moduleExports.get(this.memberName(path.node)) || null;
        }

        return null;
    },

    /** @description Applies small mapped edits after source construction diagnostics have run. */
    apply(source, emitted, tree)
    {
        const { content, declarations, externals } = source;
        const factories = [ ...declarations, ...LgdModuleBindings.values(externals) ].some(declaration => declaration.kind === 'class' && declaration.constructionKind === 'factory');
        if(!tree || !factories || !content.includes('new'))
        {
            return emitted;
        }

        const context = { externals: externals, map: LgdSourceMap.create(emitted.segments),
            declarations: new Map(declarations.filter(declaration => declaration.kind === 'class')
                .map(declaration => [ declaration.nameStart, declaration ])) };
        const edits = [];
        const constructionSites = [];
        let dynamicScope = false;
        function inspectEval(path)
        {
            if(path.get('callee').isIdentifier({ name: 'eval' }) && !path.scope.getBinding('eval'))
            {
                dynamicScope = true;
            }
        }

        traverse(tree, { CallExpression: inspectEval });
        if(dynamicScope)
        {
            return emitted;
        }

        const masked = maskCode(emitted.code, true);
        const inspectConstruction = path =>
        {
            const node = path.node;
            const start = context.map.toSource(node.start);
            if(!content.startsWith('new', start) || !emitted.code.startsWith('new', node.start))
            {
                return;
            }

            const declaration = this.resolve(path.get('callee'), context);
            if(declaration?.kind !== 'class' || declaration.constructionKind !== 'factory')
            {
                return;
            }

            const suffix = masked.slice(node.callee.end, node.end).replace(/\s/g, '');
            const hasArguments = node.arguments.length > 0 || suffix.endsWith('()');
            edits.push({ start: node.start, end: node.start + 'new'.length, text: '(' });
            const factory = node.callee.end === node.end ? '.create())' : '.create';
            edits.push({ start: node.callee.end, end: node.callee.end, text: factory });
            if(node.callee.end !== node.end)
            {
                edits.push({ start: node.end, end: node.end, text: hasArguments ? ')' : '())' });
            }

            constructionSites.push({ start: start, end: context.map.toSource(node.end),
                calleeStart: context.map.toSource(node.callee.start), calleeEnd: context.map.toSource(node.callee.end) });
        };

        traverse(tree, { NewExpression: inspectConstruction });
        if(edits.length === 0)
        {
            return emitted;
        }

        const segments = emitted.segments.map(segment => ({ ...segment }));
        const code = LgdSourceMap.applyEdits(emitted.code, segments, edits);
        return { code: code, segments: segments, constructionSites: constructionSites };
    }
};

module.exports = LgdConstructionLowering;
