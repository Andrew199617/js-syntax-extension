const traverse = require('@babel/traverse').default;
const { VISITOR_KEYS } = require('@babel/types');
const LgdValueOrigins = require('./LgdValueOrigins');

/** @description Tracks the values reaching each lexical binding without re-parsing generated JavaScript. */
const LgdBindingFlow = {
    /** @description Builds expression-point snapshots using the Babel tree already used by the checkers. */
    create(tree)
    {
        const flow = Object.create(this);
        flow._values = LgdValueOrigins.create(flow);
        flow._snapshots = new WeakMap();
        flow._reachable = new WeakSet();
        flow._overriddenReturns = new WeakSet();
        flow._locals = new Map();
        flow._externalWrites = new Set();
        flow._observers = [];
        const roots = [];
        const bindings = new Set();
        traverse(tree, {
            /** @description Collects lexical owners and their existing Babel bindings. */
            enter: path =>
            {
                if(path.isProgram() || path.isFunction())
                {
                    roots.push(path);
                }

                if(path.isScopable())
                {
                    for(const binding of Object.values(path.scope.bindings))
                    {
                        bindings.add(binding);
                    }
                }
            }
        });
        for(const binding of bindings)
        {
            const owner = flow._owner(binding);
            if(!flow._locals.has(owner))
            {
                flow._locals.set(owner, []);
            }

            flow._locals.get(owner).push(binding);
            if(binding.constantViolations.some(violation => flow._isExternalWrite(violation, owner)))
            {
                flow._externalWrites.add(binding);
            }
        }

        for(const root of roots)
        {
            const environment = flow._environment(root);
            flow._record(root, environment);
            if(root.isProgram())
            {
                flow._sequence(root.get('body'), environment);
            }
            else
            {
                flow._parameters(root, environment);
                const body = root.get('body');
                if(body.isBlockStatement())
                {
                    flow._statement(body, environment);
                }
                else
                {
                    flow._expression(body, environment);
                }
            }
        }

        return flow;
    },

    /** @description Returns value origins or type markers for a binding at the expression's execution point. */
    origins(path, binding)
    {
        const environment = this._snapshots.get(path.node);
        return environment?.has(binding) ? [...environment.get(binding)] : null;
    },

    /** @description Identifies executed paths and returns whose result survives any enclosing finally block. */
    reachable(path)
    {
        return this._reachable.has(path.node) && !this._overriddenReturns.has(path.node);
    },

    /** @description Proves the truthiness of an expression's current value, or returns null when uncertain. */
    truth(path) { return this._values.choice(path, false); },

    /** @description Proves whether an expression's current value is nullish, or returns null when uncertain. */
    nullish(path) { return this._values.choice(path, true); },

    /** @description Projects destructured assignment targets using their actual source values and defaults. */
    originsForTarget(pattern, origins)
    {
        return this._values.originsForTarget(pattern, origins);
    },

    _owner(binding) { return (binding.scope.getFunctionParent() || binding.scope.getProgramParent()).path.node; },

    _isExternalWrite(violation, owner)
    {
        const writer = violation.getFunctionParent();
        return writer ? writer.node !== owner : owner.type !== 'Program';
    },

    _environment(root)
    {
        const environment = new Map();
        for(const binding of Object.values(root.scope.getAllBindings()))
        {
            if(this._owner(binding) === root.node)
            {
                continue;
            }

            if(binding.constant && binding.path.isVariableDeclarator() && binding.path.node.init)
            {
                environment.set(binding, this._values.capture(binding.path.get('init')));
            }
            else if(binding.constant && binding.kind === 'hoisted')
            {
                environment.set(binding, ['Function']);
            }
            else
            {
                environment.set(binding, ['Unknown']);
            }
        }

        for(const binding of this._locals.get(root.node) || [])
        {
            let origins = ['undefined'];
            if(binding.kind === 'param' || binding.kind === 'module')
            {
                origins = ['__declared__'];
            }
            else if(binding.kind === 'hoisted')
            {
                origins = ['Function'];
            }
            else if(binding.path.isClassDeclaration())
            {
                origins = ['__declared__'];
            }

            environment.set(binding, origins);
        }

        return environment;
    },

    _parameters(root, environment)
    {
        for(const parameter of root.get('params'))
        {
            this._record(parameter, environment);
            if(parameter.isAssignmentPattern())
            {
                const defaulted = this._expression(parameter.get('right'), new Map(environment));
                environment = this._replace(environment, this._join([ environment, defaulted ]));
                this._assignPattern(parameter.get('left'), [ '__declared__', parameter.get('right') ], environment);
            }
        }
    },

    _replace(target, source)
    {
        target.clear();
        for(const [ binding, origins ] of source)
        {
            target.set(binding, origins);
        }

        return target;
    },

    _join(environments)
    {
        const joined = new Map();
        const bindings = new Set(environments.flatMap(environment => [...environment.keys()]));
        for(const binding of bindings)
        {
            const origins = new Set();
            for(const environment of environments)
            {
                for(const origin of environment.get(binding) || ['Unknown'])
                {
                    origins.add(origin);
                }
            }

            joined.set(binding, [...origins]);
        }

        return joined;
    },

    _same(left, right)
    {
        if(left.size !== right.size)
        {
            return false;
        }

        for(const [ binding, origins ] of left)
        {
            const other = right.get(binding);
            if(!other || origins.length !== other.length || origins.some(origin => !other.includes(origin)))
            {
                return false;
            }
        }

        return true;
    },

    _record(path, environment)
    {
        if(!path.node)
        {
            return;
        }

        this._reachable.add(path.node);
        const previous = this._snapshots.get(path.node);
        const snapshot = previous ? this._join([ previous, environment ]) : new Map(environment);
        this._snapshots.set(path.node, snapshot);
        this._observe(environment);
    },

    _observe(environment)
    {
        for(const observed of this._observers)
        {
            observed.push(new Map(environment));
        }
    },

    _mergeOutcomes(target, source)
    {
        for(const [ completion, environment ] of source)
        {
            const previous = target.get(completion);
            target.set(completion, previous ? this._join([ previous, environment ]) : environment);
        }

        return target;
    },

    _sequence(statements, environment)
    {
        const outcomes = new Map([[ 'normal', environment ]]);
        for(const statement of statements)
        {
            const normal = outcomes.get('normal');
            if(!normal)
            {
                break;
            }

            outcomes.delete('normal');
            this._mergeOutcomes(outcomes, this._statement(statement, normal));
        }

        return outcomes;
    },

    _statement(path, environment, labels = [])
    {
        if(!path.node)
        {
            return new Map([[ 'normal', environment ]]);
        }

        this._record(path, environment);
        switch(path.node.type)
        {
            case 'Program':
            case 'BlockStatement': return this._sequence(path.get('body'), environment);
            case 'ExpressionStatement':
                return new Map([[ 'normal', this._expression(path.get('expression'), environment) ]]);
            case 'VariableDeclaration':
                for(const declaration of path.get('declarations'))
                {
                    this._record(declaration, environment);
                    const initializer = declaration.get('init');
                    environment = this._expression(initializer, environment);
                    this._assignPattern(declaration.get('id'), initializer.node ? [initializer] : ['undefined'], environment);
                }

                return new Map([[ 'normal', environment ]]);
            case 'ReturnStatement':
            case 'ThrowStatement':
            {
                const completion = path.isReturnStatement() ? 'return' : 'throw';
                return new Map([[ completion, this._expression(path.get('argument'), environment) ]]);
            }

            case 'BreakStatement':
            case 'ContinueStatement':
            {
                let completion = path.isBreakStatement() ? 'break' : 'continue';
                if(path.node.label)
                {
                    completion += `:${path.node.label.name}`;
                }

                return new Map([[ completion, environment ]]);
            }

            case 'IfStatement': return this._ifStatement(path, environment);
            case 'WhileStatement':
            case 'DoWhileStatement':
            case 'ForStatement':
            case 'ForInStatement':
            case 'ForOfStatement': return this._loop(path, environment, labels);
            case 'LabeledStatement':
            {
                const label = path.node.label.name;
                const outcomes = this._statement(path.get('body'), environment, [ ...labels, label ]);
                const broken = outcomes.get(`break:${label}`);
                if(broken)
                {
                    outcomes.delete(`break:${label}`);
                    this._mergeOutcomes(outcomes, new Map([[ 'normal', broken ]]));
                }

                return outcomes;
            }

            case 'TryStatement': return this._tryStatement(path, environment);
            case 'SwitchStatement': return this._switchStatement(path, environment);
            case 'FunctionDeclaration': return new Map([[ 'normal', environment ]]);
            default: return new Map([[ 'normal', this._children(path, environment) ]]);
        }
    },

    _ifStatement(path, environment)
    {
        const tested = this._expression(path.get('test'), environment);
        const chosen = this.truth(path.get('test'));
        if(chosen !== null)
        {
            const selected = chosen ? 'consequent' : 'alternate';
            return this._statement(path.get(selected), tested);
        }

        const consequent = this._statement(path.get('consequent'), new Map(tested));
        const alternate = this._statement(path.get('alternate'), new Map(tested));
        return this._mergeOutcomes(consequent, alternate);
    },

    _loop(path, environment, labels)
    {
        const iteration = path.isForInStatement() || path.isForOfStatement();
        const test = iteration ? null : path.get('test');
        const body = path.get('body');
        if(path.isForStatement())
        {
            const initializer = path.get('init');
            if(initializer.isVariableDeclaration())
            {
                environment = this._statement(initializer, environment).get('normal');
            }
            else
            {
                environment = this._expression(initializer, environment);
            }
        }
        else if(iteration)
        {
            environment = this._expression(path.get('right'), environment);
            if(this._values.emptyIteration(path))
            {
                return new Map([[ 'normal', environment ]]);
            }
        }

        const initial = new Map(environment);
        let head = new Map(initial);
        let outcomes = new Map();
        let exited;
        let lastNext = null;
        let repeats = true;
        while(repeats)
        {
            let entered = new Map(head);
            if(test && !path.isDoWhileStatement())
            {
                entered = this._expression(test, entered);
            }

            if(test?.node?.type === 'BooleanLiteral' && !test.node.value && !path.isDoWhileStatement())
            {
                return new Map([[ 'normal', entered ]]);
            }

            exited = new Map(entered);
            if(iteration)
            {
                this._values.invalidateEffects(path, entered);
                this._iterationBinding(path.get('left'), path.isForInStatement() ? 'String' : 'Unknown', entered);
            }

            const current = this._statement(body, entered);
            const repeating = [];
            const continues = [ 'normal', 'continue', ...labels.map(label => `continue:${label}`) ];
            for(const completion of continues)
            {
                const continued = current.get(completion);
                if(continued)
                {
                    current.delete(completion);
                    repeating.push(continued);
                }
            }

            let next = null;
            if(repeating.length > 0)
            {
                next = this._join(repeating);
                if(path.isForStatement())
                {
                    next = this._expression(path.get('update'), next);
                }
                else if(path.isDoWhileStatement())
                {
                    next = this._expression(test, next);
                }
            }

            lastNext = next;
            outcomes = this._mergeOutcomes(outcomes, current);
            if(path.isDoWhileStatement() && test.node?.type === 'BooleanLiteral' && !test.node.value)
            {
                if(next)
                {
                    this._mergeOutcomes(outcomes, new Map([[ 'normal', next ]]));
                }

                repeats = false;
            }
            else
            {
                const joined = next ? this._join([ initial, next ]) : head;
                repeats = !this._same(head, joined);
                head = joined;
            }
        }

        const breaks = [ 'break', ...labels.map(label => `break:${label}`) ];
        for(const completion of breaks)
        {
            const broken = outcomes.get(completion);
            if(broken)
            {
                outcomes.delete(completion);
                this._mergeOutcomes(outcomes, new Map([[ 'normal', broken ]]));
            }
        }

        const alwaysTrue = !iteration && (!test.node || test.node.type === 'BooleanLiteral' && test.node.value);
        if(!alwaysTrue && !path.isDoWhileStatement())
        {
            this._mergeOutcomes(outcomes, new Map([[ 'normal', exited ]]));
        }
        else if(!alwaysTrue && path.isDoWhileStatement() && test.node?.value !== false && lastNext)
        {
            this._mergeOutcomes(outcomes, new Map([[ 'normal', lastNext ]]));
        }

        return outcomes;
    },

    _iterationBinding(left, type, environment)
    {
        this._record(left, environment);
        if(left.isVariableDeclaration())
        {
            for(const declaration of left.get('declarations'))
            {
                this._record(declaration, environment);
                this._assignPattern(declaration.get('id'), [type], environment);
            }
        }
        else
        {
            this._assignPattern(left, [type], environment);
        }
    },

    _tryStatement(path, environment)
    {
        const observed = [new Map(environment)];
        this._observers.push(observed);
        const outcomes = this._statement(path.get('block'), new Map(environment));
        this._observers.pop();
        const handler = path.get('handler');
        if(handler.node && this._values.canThrow(path.get('block')))
        {
            const caught = this._join([ ...observed, ...outcomes.values() ]);
            this._record(handler, caught);
            this._assignPattern(handler.get('param'), ['Unknown'], caught);
            outcomes.delete('throw');
            this._mergeOutcomes(outcomes, this._statement(handler.get('body'), caught));
        }

        const finalizer = path.get('finalizer');
        if(!finalizer.node)
        {
            return outcomes;
        }

        const result = new Map();
        let canResume = false;
        for(const [ completion, completed ] of outcomes)
        {
            const finalized = this._statement(finalizer, new Map(completed));
            const normal = finalized.get('normal');
            if(normal)
            {
                canResume = true;
                finalized.delete('normal');
                this._mergeOutcomes(result, new Map([[ completion, normal ]]));
            }

            this._mergeOutcomes(result, finalized);
        }

        if(!canResume)
        {
            this._overrideReturns(path.get('block'));
            if(handler.node)
            {
                this._overrideReturns(handler.get('body'));
            }
        }

        return result;
    },

    _overrideReturns(path)
    {
        path.traverse({
            Function: nested => nested.skip(),

            /** @description Excludes earlier returns replaced by an always-abrupt finally block. */
            ReturnStatement: returned =>
            {
                this._overriddenReturns.add(returned.node);
                if(returned.node.argument)
                {
                    this._overriddenReturns.add(returned.node.argument);
                }
            }
        });
    },

    _switchStatement(path, environment)
    {
        const tested = this._expression(path.get('discriminant'), environment);
        const cases = path.get('cases');
        const outcomes = new Map();
        let unmatched = new Map(tested);
        for(const branch of cases)
        {
            this._record(branch, unmatched);
            unmatched = this._expression(branch.get('test'), unmatched);
        }

        const choices = this._values.switchCases(path);
        if(choices.canMiss)
        {
            outcomes.set('normal', new Map(unmatched));
        }

        for(const index of choices.indices)
        {
            const statements = cases.slice(index).flatMap(branch => branch.get('consequent'));
            const selected = this._sequence(statements, this._join([ tested, unmatched ]));
            const broken = selected.get('break');
            if(broken)
            {
                selected.delete('break');
                this._mergeOutcomes(selected, new Map([[ 'normal', broken ]]));
            }

            this._mergeOutcomes(outcomes, selected);
        }

        return outcomes;
    },

    _expression(path, environment)
    {
        if(!path?.node)
        {
            return environment;
        }

        this._record(path, environment);
        if(path.isFunction())
        {
            if(path.node.computed)
            {
                environment = this._expression(path.get('key'), environment);
                this._values.invalidateEffects(path, environment);
            }

            return environment;
        }

        if(path.isAssignmentExpression())
        {
            const left = path.get('left');
            if(!left.isPattern())
            {
                environment = this._expression(left, environment);
            }

            const logical = [ '&&=', '||=', '??=' ].includes(path.node.operator);
            const chosen = logical ? this._logicalChoice(path.node.operator, left) : true;
            if(chosen === false)
            {
                return environment;
            }

            const before = new Map(environment);
            environment = this._expression(path.get('right'), environment);
            const origins = path.node.operator === '=' || logical ? [path.get('right')] : [path];
            this._assignPattern(left, origins, environment, left.isPattern());
            this._values.invalidateEffects(path, environment);
            return chosen === null ? this._join([ before, environment ]) : environment;
        }

        if(path.isUpdateExpression())
        {
            environment = this._expression(path.get('argument'), environment);
            this._assignPattern(path.get('argument'), [path], environment, false);
            this._values.invalidateEffects(path, environment);
            return environment;
        }

        if(path.isConditionalExpression())
        {
            environment = this._expression(path.get('test'), environment);
            const selected = this.truth(path.get('test'));
            if(selected !== null)
            {
                return this._expression(path.get(selected ? 'consequent' : 'alternate'), environment);
            }

            return this._join([
                this._expression(path.get('consequent'), new Map(environment)),
                this._expression(path.get('alternate'), new Map(environment))
            ]);
        }

        if(path.isLogicalExpression())
        {
            environment = this._expression(path.get('left'), environment);
            const chosen = this._logicalChoice(path.node.operator, path.get('left'));
            if(chosen === false)
            {
                return environment;
            }

            const right = this._expression(path.get('right'), new Map(environment));
            return chosen === null ? this._join([ environment, right ]) : right;
        }

        environment = this._children(path, environment);
        this._values.invalidateEffects(path, environment);

        return environment;
    },

    _children(path, environment)
    {
        for(const key of VISITOR_KEYS[path.node.type] || [])
        {
            const child = path.get(key);
            const children = Array.isArray(child) ? child : [child];
            for(const nested of children)
            {
                if(!nested.node)
                {
                    continue;
                }

                if(nested.isStatement())
                {
                    environment = this._statement(nested, environment).get('normal') || environment;
                }
                else
                {
                    environment = this._expression(nested, environment);
                }
            }
        }

        return environment;
    },

    _logicalChoice(operator, left) { return this._values.rightBranch(operator, left); },

    _sources(origins) { return this._values.sources(origins); },
    _project(origins, key, array) { return this._values.project(origins, key, array); },
    _propertyKey(property) { return this._values.propertyKey(property); },

    _defaultOrigins(path, origins, environment)
    {
        const defaults = this._values.defaults(path, origins);
        if(!defaults.possible)
        {
            return origins;
        }

        const defaulted = this._expression(path.get('right'), new Map(environment));
        this._replace(environment, defaults.definite ? defaulted : this._join([ environment, defaulted ]));
        return defaults.origins;
    },

    _assignPattern(path, origins, environment, record = true)
    {
        if(!path.node)
        {
            return;
        }

        if(record)
        {
            this._record(path, environment);
        }

        if(path.isIdentifier())
        {
            const binding = path.scope.getBinding(path.node.name);
            if(binding)
            {
                environment.set(binding, origins);
                this._observe(environment);
            }

            return;
        }

        if(path.isMemberExpression())
        {
            this._values.invalidateContainers(environment, path.get('object'));
        }
        else if(path.isAssignmentPattern())
        {
            const defaulted = this._defaultOrigins(path, origins, environment);
            this._assignPattern(path.get('left'), defaulted, environment);
        }
        else if(path.isRestElement())
        {
            this._assignPattern(path.get('argument'), origins, environment);
        }
        else if(path.isArrayPattern())
        {
            const elements = path.get('elements');
            for(let index = 0; index < elements.length; index++)
            {
                const element = elements[index];
                const projected = element.isRestElement() ? ['Array'] : this._project(origins, index, true);
                this._assignPattern(element, projected, environment);
            }
        }
        else if(path.isObjectPattern())
        {
            for(const property of path.get('properties'))
            {
                if(property.isRestElement())
                {
                    this._assignPattern(property.get('argument'), ['Object'], environment);
                    continue;
                }

                if(property.node.computed)
                {
                    this._expression(property.get('key'), environment);
                }

                const key = this._propertyKey(property);
                const projected = key === null ? ['Unknown'] : this._project(origins, key, false);
                this._assignPattern(property.get('value'), projected, environment);
            }
        }

        this._values.invalidateEffects(path, environment);
    }
};

module.exports = LgdBindingFlow;
