const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdSourceMap = require('./LgdSourceMap');
const { maskCode } = require('./LgdInfer');

/** @description Checks constructor returns before either JavaScript output model applies recovery lowering. */
const LgdConstructorReturnChecker = {
    /** @description Limits the extra syntax pass to explicit constructors containing a possible return. */
    hasCandidates(content, declarations)
    {
        return declarations.some(declaration =>
        {
            if(declaration.kind !== 'class')
            {
                return false;
            }

            return declaration.classMembers.some(member =>
            {
                const body = content.slice(member.bodyStart, member.bodyEnd);
                return member.isConstructor && (/\breturn\b/).test(maskCode(body, true));
            });
        });
    },

    /** @description Rejects every directly owned value return, including unreachable ones, without inspecting callback returns. */
    check(content, declarations, emitted)
    {
        let tree;
        try
        {
            tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true, errorRecovery: true });
        }
        catch
        {
            // The ordinary syntax validator reports incomplete bodies; avoid guessing return ownership.
            return [];
        }

        const constructors = declarations.filter(declaration => declaration.kind === 'class')
            .flatMap(declaration => declaration.classMembers.filter(member => member.isConstructor)
                .map(member => ({ declaration: declaration, member: member })));

        const map = LgdSourceMap.create(emitted.segments);
        const errors = [];
        traverse(tree, {
            noScope: true,

            /** @description Matches a source return to its immediate constructor function, excluding generated allocation returns. */
            ReturnStatement: path =>
            {
                const argument = path.node.argument;
                const owner = path.getFunctionParent();
                if(!argument || !owner)
                {
                    return;
                }

                const returnStart = map.toSource(path.node.start);
                const bodyStart = map.toSource(owner.node.body.start);
                const record = constructors.find(({ member }) =>
                {
                    const sourceReturn = member.bodyStart < returnStart && returnStart < member.bodyEnd;
                    const immediateOwner = member.start <= bodyStart && bodyStart <= member.bodyStart;
                    return sourceReturn && immediateOwner;
                });

                if(!record || content.slice(returnStart, returnStart + 'return'.length) !== 'return')
                {
                    return;
                }

                const error = {
                    code: 'lgd.constructor.returnValue', category: 'syntax', severity: 'error',
                    offset: map.toSource(argument.start), endOffset: map.toSource(argument.end),
                    message: 'An LGD constructor cannot return a value. Initialize this instance; use return; only for an early exit.'
                };
                const returnEnd = map.toSource(path.node.end);
                const statement = content.slice(returnStart, returnEnd);
                if(argument.type === 'ThisExpression' && (/^return\b[\s(]*this[\s)]*;?$/).test(statement))
                {
                    error.quickFix = { kind: 'replaceConstructorReturnThis', declarationStart: record.declaration.headStart,
                        memberStart: record.member.start, offset: returnStart, endOffset: returnEnd };
                }

                errors.push(error);
            }
        });
        return errors;
    }
};

module.exports = LgdConstructorReturnChecker;
