/** @description Tracks normal and abrupt completion paths without entering nested functions. */
const LgdReturnFlow = {
    /** @description Combines statement completion paths in execution order. */
    sequence(statements)
    {
        let outcomes = new Set(['normal']);
        for(const statement of statements)
        {
            if(!outcomes.delete('normal'))
            {
                break;
            }

            outcomes = new Set([ ...outcomes, ...this.statement(statement) ]);
        }

        return outcomes;
    },

    /** @description Computes the completion paths of a statement. */
    statement(node)
    {
        if(!node)
        {
            return new Set(['normal']);
        }

        switch(node.type)
        {
            case 'ReturnStatement': return new Set(['return']);
            case 'ThrowStatement': return new Set(['throw']);
            case 'BreakStatement': return new Set([node.label ? `break:${node.label.name}` : 'break']);
            case 'ContinueStatement': return new Set([node.label ? `continue:${node.label.name}` : 'continue']);
            case 'BlockStatement': return this.sequence(node.body);
            case 'IfStatement':
            {
                if(node.test.type === 'BooleanLiteral')
                {
                    return this.statement(node.test.value ? node.consequent : node.alternate);
                }

                return new Set([ ...this.statement(node.consequent), ...this.statement(node.alternate) ]);
            }

            case 'TryStatement': return this.tryStatement(node);
            case 'SwitchStatement': return this.switchStatement(node);
            case 'WhileStatement':
            case 'DoWhileStatement':
            case 'ForStatement':
            case 'ForInStatement':
            case 'ForOfStatement': return this.loop(node);
            case 'LabeledStatement': return this.labeled(node);

            default: return new Set(['normal']);
        }
    },

    /** @description Associates stacked labels with their loop before consuming labeled exits. */
    labeled(node)
    {
        const labels = [];
        let target = node;
        while(target.type === 'LabeledStatement')
        {
            labels.push(target.label.name);
            target = target.body;
        }

        const loopTypes = [ 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement' ];
        if(loopTypes.includes(target.type))
        {
            return this.loop(target, labels);
        }

        const outcomes = this.statement(target);
        for(const label of labels)
        {
            if(outcomes.delete(`break:${label}`))
            {
                outcomes.add('normal');
            }
        }

        return outcomes;
    },

    /** @description Accounts for catch paths and finally blocks that replace earlier exits. */
    tryStatement(node)
    {
        const outcomes = this.statement(node.block);
        if(node.handler)
        {
            outcomes.delete('throw');
            for(const outcome of this.statement(node.handler.body))
            {
                outcomes.add(outcome);
            }
        }

        if(!node.finalizer)
        {
            return outcomes;
        }

        const final = this.statement(node.finalizer);
        if(final.delete('normal'))
        {
            return new Set([ ...outcomes, ...final ]);
        }

        return final;
    },

    /** @description Follows case fallthrough and consumes switch-local breaks. */
    switchStatement(node)
    {
        const outcomes = new Set();
        if(!node.cases.some(branch => branch.test === null))
        {
            outcomes.add('normal');
        }

        for(let index = 0; index < node.cases.length; index++)
        {
            const statements = node.cases.slice(index).flatMap(branch => branch.consequent);
            for(const outcome of this.sequence(statements))
            {
                outcomes.add(outcome === 'break' ? 'normal' : outcome);
            }
        }

        return outcomes;
    },

    /** @description Distinguishes potentially skipped loops from loops with no normal exit. */
    loop(node, labels = [])
    {
        const outcomes = this.statement(node.body);
        let canBreak = outcomes.delete('break');
        let canContinue = outcomes.delete('continue');
        for(const label of labels)
        {
            canBreak = outcomes.delete(`break:${label}`) || canBreak;
            canContinue = outcomes.delete(`continue:${label}`) || canContinue;
        }

        const canComplete = outcomes.delete('normal');
        const endlessFor = node.type === 'ForStatement' && !node.test;
        const alwaysTrue = node.test && node.test.type === 'BooleanLiteral' && node.test.value;
        const repeatsForever = endlessFor || alwaysTrue;
        if(canBreak || !repeatsForever && node.type !== 'DoWhileStatement')
        {
            outcomes.add('normal');
        }
        else if(node.type === 'DoWhileStatement' && !repeatsForever && (canComplete || canContinue))
        {
            outcomes.add('normal');
        }

        return outcomes;
    }
};

module.exports = LgdReturnFlow;
