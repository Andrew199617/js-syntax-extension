/** @description Resolves reaching value sources, literal projections, and safe branch facts. */
const LgdValueOrigins = {
    /** @description Associates value-source helpers with a binding flow. */
    create(flow)
    {
        const values = Object.create(this);
        values._flow = flow;
        return values;
    },

    /** @description Resolves aliases while preventing circular value-origin expansion. */
    sources(origins, visited = new Set())
    {
        return this._sources(origins, visited);
    },

    /** @description Projects a known array element or object property into its value origins. */
    project(origins, key, array)
    {
        return this._project(origins, key, array);
    },

    /** @description Resolves a static object-pattern property name. */
    propertyKey(property)
    {
        return this._propertyKey(property);
    },

    /** @description Proves truthiness or nullishness only when every reaching origin agrees. */
    choice(path, nullish)
    {
        return this._choice(path, nullish, new Set());
    },

    /** @description Returns assignment targets and their projected values for a destructuring pattern. */
    originsForTarget(pattern, origins)
    {
        const targets = [];
        this._targets(pattern, origins, targets);
        return targets;
    },

    /** @description Preserves captured primitive constants while withholding mutable container structure. */
    capture(initializer)
    {
        if(initializer.isArrayExpression())
        {
            return ['Array'];
        }

        return initializer.isObjectExpression() ? ['Object'] : [initializer];
    },

    /** @description Resolves a destructuring default only when undefined is a possible source value. */
    defaults(pattern, origins)
    {
        const resolved = this._sources(origins);
        const definite = resolved.every(origin => origin === 'undefined');
        const possible = definite || resolved.includes('Unknown') || resolved.includes('undefined');
        const knownDefault = resolved.includes('undefined');
        const selected = knownDefault ? [ ...resolved.filter(origin => origin !== 'undefined'), pattern.get('right') ] : origins;
        return { origins: selected, definite: definite, possible: possible };
    },

    /** @description Invalidates mutable literal structure after aliases may write properties or escape to calls. */
    invalidateContainers(environment, object = null)
    {
        while(object && object.isMemberExpression())
        {
            object = object.get('object');
        }

        const affected = object ? this._sources([object]) : null;
        for(const [ binding, origins ] of environment)
        {
            const sources = this._sources(origins);
            const containers = sources.filter(source => this._container(source));

            if(containers.length === 0 || affected && !containers.some(source => affected.includes(source)))
            {
                continue;
            }

            const widened = sources.map(source =>
            {
                if(typeof source !== 'string' && source.isArrayExpression())
                {
                    return 'Array';
                }

                return typeof source !== 'string' && source.isObjectExpression() ? 'Object' : source;
            });

            environment.set(binding, [...new Set(widened)]);
        }
    },

    /** @description Recognizes simple blocks whose primitive local writes cannot transfer control to catch. */
    canThrow(block)
    {
        return !block.get('body').every(statement => this._cannotThrow(statement));
    },

    _cannotThrow(path)
    {
        if(path.isEmptyStatement() || path.isFunctionDeclaration())
        {
            return true;
        }

        if(path.isVariableDeclaration())
        {
            return path.get('declarations').every(declaration => this._pureDeclaration(declaration));
        }

        if(path.isExpressionStatement())
        {
            const expression = path.get('expression');
            if(!expression.isAssignmentExpression())
            {
                return this._pure(expression);
            }

            const left = expression.get('left');
            const binding = left.isIdentifier() && left.scope.getBinding(left.node.name);
            const local = binding && this._flow._owner(binding) === path.getFunctionParent()?.node;
            const lexicalReady = local && binding.identifier.start < expression.node.start;
            const initialized = binding && (binding.kind === 'var' || binding.kind === 'param' || lexicalReady);
            const mutableWrite = expression.node.operator === '=' && initialized && binding.kind !== 'const';
            return mutableWrite && this._pure(expression.get('right'));
        }

        return path.isReturnStatement() && this._pure(path.get('argument'));
    },

    _container(source)
    {
        return typeof source !== 'string' && (source.isArrayExpression() || source.isObjectExpression());
    },

    _pureDeclaration(declaration)
    {
        return declaration.get('id').isIdentifier() && this._pure(declaration.get('init'));
    },

    _pure(path)
    {
        if(!path.node)
        {
            return true;
        }

        return [ 'NumericLiteral',
            'StringLiteral',
            'BooleanLiteral',
            'BigIntLiteral',
            'NullLiteral',
            'FunctionExpression',
            'ArrowFunctionExpression' ].includes(path.node.type);
    },

    /** @description Invalidates proof after unknown calls, getters, tags, suspension, or direct eval. */
    invalidateEffects(path, environment)
    {
        if(!this._effectful(path))
        {
            return;
        }

        this.invalidateContainers(environment);
        const callee = path.isCallExpression() && path.get('callee');
        const directEval = callee && callee.isIdentifier({ name: 'eval' }) && !path.scope.getBinding('eval');
        for(const binding of environment.keys())
        {
            const mutable = ![ 'const', 'module', 'hoisted' ].includes(binding.kind);
            if(this._flow._externalWrites.has(binding) || directEval && mutable)
            {
                environment.set(binding, ['Unknown']);
            }
        }

        this._flow._observe(environment);
    },

    /** @description Recognizes literal collections with no iteration values or enumerable keys. */
    emptyIteration(path)
    {
        const sources = this._sources([path.get('right')]);
        return sources.length > 0 && sources.every(source => this._empty(source, path.isForInStatement()));
    },

    _effectful(path)
    {
        const effects = [ 'CallExpression',
            'OptionalCallExpression',
            'NewExpression',
            'AwaitExpression',
            'YieldExpression',
            'MemberExpression',
            'OptionalMemberExpression',
            'TaggedTemplateExpression',
            'SpreadElement',
            'ObjectPattern',
            'ArrayPattern',
            'ForOfStatement',
            'ForInStatement',
            'UpdateExpression' ];
        if(effects.includes(path.node.type))
        {
            return true;
        }

        if(path.isAssignmentExpression())
        {
            return ![ '=', '&&=', '||=', '??=' ].includes(path.node.operator) || path.get('left').isMemberExpression();
        }

        if(path.isBinaryExpression())
        {
            return ![ '===', '!==' ].includes(path.node.operator);
        }

        if(path.isUnaryExpression())
        {
            return [ '+', '-', '~', 'delete' ].includes(path.node.operator);
        }

        if(path.isTemplateLiteral())
        {
            return path.node.expressions.length > 0;
        }

        return Boolean(path.node.computed);
    },

    _empty(source, keys)
    {
        if(typeof source === 'string')
        {
            return false;
        }

        if(source.isArrayExpression())
        {
            return source.node.elements.length === 0;
        }

        if(keys && source.isObjectExpression())
        {
            return source.node.properties.length === 0;
        }

        return source.isStringLiteral() && source.node.value.length === 0;
    },

    /** @description Selects only provably possible switch entries while retaining fallthrough. */
    switchCases(path)
    {
        const cases = path.get('cases');
        const fallback = cases.findIndex(branch => !branch.node.test);
        const unknown = { indices: cases.map((branch, index) => index), canMiss: fallback === -1 };
        const discriminant = this._constant(path.get('discriminant'));
        if(!discriminant)
        {
            return unknown;
        }

        let selected = -1;
        for(let index = 0; index < cases.length; index++)
        {
            const branch = cases[index];
            if(!branch.node.test)
            {
                continue;
            }

            const tested = this._constant(branch.get('test'));
            if(!tested)
            {
                return unknown;
            }

            if(selected < 0 && tested.value === discriminant.value)
            {
                selected = index;
            }
        }

        if(selected < 0)
        {
            selected = fallback;
        }

        return { indices: selected < 0 ? [] : [selected], canMiss: selected < 0 };
    },

    _constant(path)
    {
        const values = this._sources([path]).map(source =>
        {
            if(source === 'undefined')
            {
                return {};
            }

            return typeof source === 'string' ? null : this._literal(source);
        });

        if(values.length === 0 || values.includes(null))
        {
            return null;
        }

        return values.every(value => value.value === values[0].value) ? values[0] : null;
    },

    _targets(pattern, origins, targets)
    {
        if(!pattern.node)
        {
            return;
        }

        if(pattern.isIdentifier() || pattern.isMemberExpression())
        {
            targets.push({ target: pattern, origins: origins });
        }
        else if(pattern.isAssignmentPattern())
        {
            this._targets(pattern.get('left'), this.defaults(pattern, origins).origins, targets);
        }
        else if(pattern.isRestElement())
        {
            this._targets(pattern.get('argument'), origins, targets);
        }
        else if(pattern.isArrayPattern())
        {
            const elements = pattern.get('elements');
            for(let index = 0; index < elements.length; index++)
            {
                const element = elements[index];
                const values = element.isRestElement() ? ['Array'] : this._project(origins, index, true);
                this._targets(element, values, targets);
            }
        }
        else if(pattern.isObjectPattern())
        {
            for(const property of pattern.get('properties'))
            {
                if(property.isRestElement())
                {
                    this._targets(property.get('argument'), ['Object'], targets);
                    continue;
                }

                const key = this._propertyKey(property);
                const values = key === null ? ['Unknown'] : this._project(origins, key, false);
                this._targets(property.get('value'), values, targets);
            }
        }
    },

    /** @description Selects the right-hand side of a logical operation when its left value proves the branch. */
    rightBranch(operator, left)
    {
        if(operator === '??' || operator === '??=')
        {
            return this.choice(left, true);
        }

        const truth = this.choice(left, false);
        if(truth === null)
        {
            return null;
        }

        return operator === '&&' || operator === '&&=' ? truth : !truth;
    },

    _choice(path, nullish, visited)
    {
        const facts = this._sources([path], visited).map(origin => this._fact(origin, nullish));
        if(facts.length === 0 || facts.includes(null))
        {
            return null;
        }

        return facts.every(fact => fact === facts[0]) ? facts[0] : null;
    },

    _fact(origin, nullish)
    {
        if(typeof origin === 'string')
        {
            if(origin === 'Unknown' || origin === '__declared__')
            {
                return null;
            }

            if(origin === 'undefined' || origin === 'null')
            {
                return nullish;
            }

            if(nullish)
            {
                return false;
            }

            return [ 'Object', 'Array', 'Function' ].includes(origin) ? true : null;
        }

        const literal = this._literal(origin);
        if(literal)
        {
            return nullish ? literal.value === null || literal.value === undefined : Boolean(literal.value);
        }

        const objects = [ 'ObjectExpression',
            'ArrayExpression',
            'FunctionExpression',
            'ArrowFunctionExpression',
            'ClassExpression',
            'NewExpression',
            'RegExpLiteral' ];
        if(objects.includes(origin.node.type))
        {
            return !nullish;
        }

        return null;
    },

    _literal(path)
    {
        const node = path.node;
        if([ 'NumericLiteral', 'StringLiteral', 'BooleanLiteral' ].includes(node.type))
        {
            return { value: node.value };
        }

        if(node.type === 'NullLiteral')
        {
            return { value: null };
        }

        if(node.type === 'BigIntLiteral')
        {
            return { value: globalThis.BigInt(node.value) };
        }

        if(node.type === 'TemplateLiteral' && node.expressions.length === 0)
        {
            return { value: node.quasis[0].value.cooked };
        }

        if(node.type === 'UnaryExpression' && node.operator === 'void')
        {
            return {};
        }

        if(node.type === 'UnaryExpression')
        {
            const argument = this._literal(path.get('argument'));
            if(argument)
            {
                switch(node.operator)
                {
                    case '!': return { value: !argument.value };
                    case '-': return { value: -argument.value };
                    case '+':
                        if(typeof argument.value === 'bigint')
                        {
                            return null;
                        }

                        return { value: +argument.value };
                    default: return null;
                }
            }
        }

        return null;
    },
    _sources(origins, visited = new Set())
    {
        const sources = [];
        for(const origin of origins)
        {
            if(typeof origin === 'string')
            {
                sources.push(origin);
                continue;
            }

            if(origin.isIdentifier())
            {
                const binding = origin.scope.getBinding(origin.node.name);
                if(!binding)
                {
                    sources.push(origin.node.name === 'undefined' ? 'undefined' : 'Unknown');
                    continue;
                }

                const reaching = this._flow.origins(origin, binding);
                if(!reaching || visited.has(binding))
                {
                    sources.push('Unknown');
                    continue;
                }

                const next = new Set(visited);
                next.add(binding);
                sources.push(...this._sources(reaching, next));
            }
            else if(origin.isUnaryExpression({ operator: 'void' }))
            {
                sources.push('undefined');
            }
            else if(origin.isAssignmentExpression() && origin.node.operator === '=')
            {
                sources.push(...this._sources([origin.get('right')], visited));
            }
            else if(origin.isSequenceExpression())
            {
                const expressions = origin.get('expressions');
                sources.push(...this._sources([expressions[expressions.length - 1]], visited));
            }
            else if(origin.isConditionalExpression())
            {
                const chosen = this._choice(origin.get('test'), false, visited);
                let branches = [ origin.get('consequent'), origin.get('alternate') ];
                if(chosen !== null)
                {
                    branches = [origin.get(chosen ? 'consequent' : 'alternate')];
                }

                sources.push(...this._sources(branches, visited));
            }
            else if(origin.isLogicalExpression())
            {
                const left = origin.get('left');
                const chosen = this._choice(left, origin.node.operator === '??', visited);
                let branches = [ left, origin.get('right') ];
                if(chosen !== null)
                {
                    const right = origin.node.operator === '&&' ? chosen : !chosen;
                    branches = [right ? origin.get('right') : left];
                    if(origin.node.operator === '??')
                    {
                        branches = [chosen ? origin.get('right') : left];
                    }
                }

                sources.push(...this._sources(branches, visited));
            }
            else
            {
                sources.push(origin);
            }
        }

        return [...new Set(sources)];
    },

    _project(origins, key, array)
    {
        const projected = [];
        for(const source of this._sources(origins))
        {
            if(typeof source === 'string')
            {
                projected.push('Unknown');
            }
            else if(array && source.isArrayExpression())
            {
                const elements = source.get('elements');
                const uncertain = elements.slice(0, key + 1).some(element => element.node && element.isSpreadElement());
                const element = elements[key];
                if(uncertain)
                {
                    projected.push('Unknown');
                }
                else
                {
                    projected.push(element?.node ? element : 'undefined');
                }
            }
            else if(!array && source.isObjectExpression())
            {
                projected.push(this._objectProperty(source, key));
            }
            else
            {
                projected.push('Unknown');
            }
        }

        return [...new Set(projected)];
    },

    _propertyKey(property)
    {
        const key = property.node.key;
        if(!property.node.computed && key.type === 'Identifier')
        {
            return key.name;
        }

        if(key.type === 'StringLiteral' || key.type === 'NumericLiteral')
        {
            return String(key.value);
        }

        return null;
    },

    _prototypeSetter(property)
    {
        const plain = property.isObjectProperty() && !property.node.computed && !property.node.shorthand;
        return plain && this._propertyKey(property) === '__proto__';
    },

    _prototypeOrigin(source, key)
    {
        const prototype = source.get('properties').find(property => this._prototypeSetter(property));
        if(prototype)
        {
            return prototype.get('value').isNullLiteral() ? 'undefined' : 'Unknown';
        }

        const inherited = [ 'constructor',
            'toString',
            'toLocaleString',
            'valueOf',
            'hasOwnProperty',
            'isPrototypeOf',
            'propertyIsEnumerable',
            '__proto__',
            '__defineGetter__',
            '__defineSetter__',
            '__lookupGetter__',
            '__lookupSetter__' ];

        return inherited.includes(key) ? 'Unknown' : 'undefined';
    },

    _objectProperty(source, key)
    {
        let value = this._prototypeOrigin(source, key);
        for(const property of source.get('properties'))
        {
            if(property.isSpreadElement())
            {
                value = 'Unknown';
                continue;
            }

            const name = this._propertyKey(property);
            if(this._prototypeSetter(property))
            {
                continue;
            }

            if(name === null)
            {
                value = 'Unknown';
            }
            else if(name === key)
            {
                value = property.get('value');
                if(property.isObjectMethod())
                {
                    value = property.node.kind === 'method' ? 'Function' : 'Unknown';
                }
            }
        }

        return value;
    }
};

module.exports = LgdValueOrigins;
