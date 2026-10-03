/** @description Distinguishes null, undefined, and all remaining values for branch refinement. */
const valueCategories = [ 'null', 'undefined', 'value' ];

/** @description Carries immutable lexical null-guard facts alongside the existing value-flow environments. */
const LgdBindingRefinements = {
    /** @description Creates refinement storage for one syntax-aware binding analysis. */
    create(flow)
    {
        const refinements = Object.create(this);
        refinements._flow = flow;
        refinements._facts = new WeakMap();
        refinements._unsafeGuardOwners = new WeakSet();
        return refinements;
    },

    /** @description Narrows known identifier results only when every reaching path proves the same null guard. */
    narrowTypes(path, binding, types)
    {
        const environment = this._flow._snapshots.get(path.node);
        const categories = this._facts.get(environment)?.get(binding);
        if(!categories)
        {
            return types;
        }

        return types.filter(type =>
        {
            const category = type === 'null' || type === 'undefined' ? type : 'value';
            return type === 'Unknown' || categories.includes(category);
        });
    },

    /** @description Withholds parameter proof when arguments aliasing or direct eval can hide writes. */
    recordDynamicScope(path)
    {
        const argumentsRead = path.isReferencedIdentifier({ name: 'arguments' }) && !path.scope.getBinding('arguments');
        const callee = path.isCallExpression() && path.get('callee');
        const directEval = callee && callee.isIdentifier({ name: 'eval' }) && !path.scope.getBinding('eval');
        if(!argumentsRead && !directEval)
        {
            return;
        }

        let owner = path.getFunctionParent();
        while(owner)
        {
            if(directEval || !owner.isArrowFunctionExpression())
            {
                this._unsafeGuardOwners.add(owner.node);
                if(!directEval)
                {
                    break;
                }
            }

            owner = owner.getFunctionParent();
        }
    },

    /** @description Refines an immutable identifier along one strict or loose null-comparison branch. */
    refine(test, environment, positive)
    {
        const refined = this.clone(environment);
        if(test.isUnaryExpression({ operator: '!' }))
        {
            return this.refine(test.get('argument'), refined, !positive);
        }

        if(!test.isBinaryExpression() || ![ '===', '!==', '==', '!=' ].includes(test.node.operator))
        {
            return refined;
        }

        const left = test.get('left');
        const right = test.get('right');
        const value = left.isNullLiteral() ? right : left;
        if(!value.isIdentifier() || !left.isNullLiteral() && !right.isNullLiteral())
        {
            return refined;
        }

        const binding = value.scope.getBinding(value.node.name);
        const dynamic = binding && binding.kind !== 'const' && this._unsafeGuardOwners.has(this._flow._owner(binding));
        if(!binding?.constant || dynamic || this._flow._externalWrites.has(binding))
        {
            return refined;
        }

        const equal = test.node.operator === '===' || test.node.operator === '==';
        const nullBranch = positive === equal;
        const loose = test.node.operator === '==' || test.node.operator === '!=';
        const matched = loose ? [ 'null', 'undefined' ] : ['null'];
        const allowed = valueCategories.filter(category => matched.includes(category) === nullBranch);
        const refinements = this._facts.get(refined) || new Map();
        const previous = refinements.get(binding) || valueCategories;
        refinements.set(binding, previous.filter(category => allowed.includes(category)));
        this._facts.set(refined, refinements);
        return refined;
    },

    /** @description Clones a value environment together with its immutable branch facts. */
    clone(environment)
    {
        const copied = new Map(environment);
        this.copy(environment, copied);
        return copied;
    },

    /** @description Copies branch facts when the flow clones or replaces an environment. */
    copy(source, target)
    {
        const facts = this._facts.get(source);
        if(facts)
        {
            this._facts.set(target, new Map(facts));
        }
        else
        {
            this._facts.delete(target);
        }
    },

    /** @description Unites possible categories so a fact survives only when every reaching path supports it. */
    join(environments, joined, bindings)
    {
        const facts = new Map();
        for(const binding of bindings)
        {
            const categories = new Set(environments.flatMap(environment => this._facts.get(environment)?.get(binding) || valueCategories));
            if(categories.size < valueCategories.length)
            {
                facts.set(binding, [...categories]);
            }
        }

        this._facts.set(joined, facts);
    },

    /** @description Includes origins and branch facts in the existing loop convergence check. */
    same(left, right)
    {
        if(left.size !== right.size)
        {
            return false;
        }

        for(const [ binding, origins ] of left)
        {
            const other = right.get(binding);
            const sameFacts = this._sameBinding(left, right, binding);
            if(!sameFacts || !other || origins.length !== other.length || origins.some(origin => !other.includes(origin)))
            {
                return false;
            }
        }

        return true;
    },

    _sameBinding(left, right, binding)
    {
        const leftFacts = this._facts.get(left)?.get(binding) || valueCategories;
        const rightFacts = this._facts.get(right)?.get(binding) || valueCategories;
        return leftFacts.length === rightFacts.length && leftFacts.every(category => rightFacts.includes(category));
    }
};

module.exports = LgdBindingRefinements;
