/** @description Locates invalid LGD member tokens and conservative balanced recovery boundaries. */
const LgdClassMemberRecovery = {
    /** @description Finds balanced parentheses or braces in already-masked source. */
    findClose(masked, start)
    {
        const open = masked[start];
        const close = open === '(' ? ')' : '}';
        let depth = 0;
        for(let index = start; index < masked.length; index++)
        {
            if(masked[index] === open)
            {
                depth++;
            }
            else if(masked[index] === close)
            {
                depth--;
                if(depth === 0)
                {
                    return index;
                }
            }
        }

        return -1;
    },

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

    /** @description Anchors a missing opener at its insertion point, retaining a hard syntax error after recovery. */
    missingBody(context)
    {
        const signature = context.hasBaseInitializer ? 'base initializer' : 'parameters';
        const memberKind = context.isConstructor ? 'constructor' : 'method';
        return {
            error: `Expected "{" after ${memberKind} ${signature}.`,
            offset: context.insertionOffset, endOffset: context.insertionOffset,
            code: 'lgd.syntax.missingMemberBody', category: 'syntax',
            recoveryOffset: context.allowBodyRecovery === false ? null : this.recoverMissingBody(context)
        };
    },

    /** @description Recovers a missing body opener only when receiver assignments precede a complete following member sequence. */
    recoverMissingBody(context)
    {
        const { content, masked, start, declaration, compiler, syntax } = context;
        const receiverAssignment = (/^this\s*\.\s*[$A-Z_a-z][\w$]*\s*=(?!=)/).test(masked.slice(start));
        const balancedBody = this.continuationClose(masked, start) === declaration.initializerEnd - 1;
        if(!receiverAssignment || !balancedBody)
        {
            return null;
        }

        const recoveryOffset = declaration.initializerEnd;
        const close = this.continuationClose(masked, recoveryOffset);
        if(close === null)
        {
            return null;
        }

        const candidate = { ...declaration, initializerEnd: close + 1 };
        let cursor = syntax.skipSpace(masked, recoveryOffset);
        let hasMember = false;
        while(cursor < close)
        {
            const lineStart = masked.lastIndexOf('\n', cursor - 1) + 1;
            const indentation = masked.slice(lineStart, cursor);
            if(!(/^[\t ]+$/).test(indentation) || indentation.length <= declaration.indent.length)
            {
                return null;
            }

            const parsed = syntax.parseMember(content, masked, cursor, {
                declaration: candidate, compiler: compiler, allowBodyRecovery: false
            });
            if(parsed.error || parsed.member.bodyEnd <= cursor || parsed.member.bodyEnd > close)
            {
                return null;
            }

            hasMember = true;
            cursor = syntax.skipSpace(masked, parsed.member.bodyEnd);
        }

        if(!hasMember)
        {
            return null;
        }

        declaration.initializerEnd = close + 1;
        declaration.end = close + 1;
        declaration.initializerText = content.slice(declaration.initializerStart, close + 1);
        return recoveryOffset;
    },

    /** @description Finds a possible continuation close while respecting nested delimiters and stopping on mismatches. */
    continuationClose(masked, start)
    {
        const stack = [];
        const closing = { '(': ')', '[': ']', '{': '}' };
        for(let cursor = start; cursor < masked.length; cursor++)
        {
            const token = masked[cursor];
            if(closing[token])
            {
                stack.push(closing[token]);
            }
            else if(token === '}' && stack.length === 0)
            {
                return cursor;
            }
            else if(token === ')' || token === ']' || token === '}')
            {
                if(stack.pop() !== token)
                {
                    return null;
                }
            }
        }

        return null;
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
