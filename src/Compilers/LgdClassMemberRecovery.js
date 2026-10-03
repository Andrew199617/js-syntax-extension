/** @description Locates invalid LGD member tokens and conservative balanced recovery boundaries. */
const LgdClassMemberRecovery = {
    /** @description Gives unsupported modifiers their own actionable token-sized diagnostic. */
    modifierError(modifier, offset)
    {
        return {
            error: `The '${modifier}' class-member modifier is not supported in LGD. Remove '${modifier}' from this member.`,
            offset: offset, endOffset: offset + modifier.length, code: 'lgd.syntax.memberModifier', category: 'syntax'
        };
    },

    /** @description Explains the actual unsupported member token without diagnosing valid signatures. */
    invalidHead(masked, start, head, declaration)
    {
        const leading = head.length - head.trimStart().length;
        let offset = start + leading;
        const token = (/^(?<token>[$A-Z_a-z][\w$]*|\S)/).exec(head.slice(leading));
        const tokenText = token ? token.groups.token : '';
        let endOffset = offset + Math.max(1, tokenText.length);
        let code = 'lgd.syntax.memberHead';
        let error = `Unexpected '${tokenText}' in an LGD class member. Use a typed field, a named method, or ${declaration.name}(...) for the constructor.`;
        const colon = (/^\s*[$A-Z_a-z][\w$]*\s*(?<colon>:)/).exec(head);
        if(tokenText === ',')
        {
            code = 'lgd.syntax.memberComma';
            error = 'Remove this comma. LGD class members are not separated by commas.';
        }
        else if(tokenText === '[')
        {
            code = 'lgd.syntax.memberComputedName';
            error = 'Computed member names are not supported in LGD classes. Use a named method or typed field.';
        }
        else if(colon)
        {
            offset = start + colon[0].length - 1;
            endOffset = offset + 1;
            code = 'lgd.syntax.memberColon';
            error = 'Object-style member declarations are not supported in LGD classes. Use Type name = value; for a field or name(...) { ... } for a method.';
        }

        return {
            error: error, offset: offset, endOffset: endOffset, code: code, category: 'syntax',
            recoveryOffset: this.findBoundary(masked, start, declaration.initializerEnd - 1)
        };
    },

    /** @description Skips only balanced members ending at a semicolon or body, never crossing the class boundary. */
    findBoundary(masked, start, end)
    {
        if(masked[start] === ',')
        {
            return start + 1;
        }

        const stack = [];
        const closing = { '(': ')', '[': ']', '{': '}' };
        for(let cursor = start; cursor < end; cursor++)
        {
            const token = masked[cursor];
            if(closing[token])
            {
                stack.push(closing[token]);
            }
            else if(token === ')' || token === ']' || token === '}')
            {
                if(stack.pop() !== token)
                {
                    return null;
                }

                if(token === '}' && stack.length === 0)
                {
                    const tail = (/^[\t ]*(?:[,;]|(?=\r?\n|$))/).exec(masked.slice(cursor + 1, end));
                    return tail ? cursor + 1 + tail[0].length : null;
                }
            }
            else if(token === ';' && stack.length === 0)
            {
                return cursor + 1;
            }
            else if(token === '\n' && stack.length === 0)
            {
                // An unfinished head might own the following line; do not promote it to a member.
                return null;
            }
        }

        return null;
    }
};

module.exports = LgdClassMemberRecovery;
