const LgdConstructorSignatures = require('./LgdConstructorSignatures');
const LgdClassFields = require('./LgdClassFields');

/** @description Lowers disjoint constructor overloads using argument counts while retaining independent body scopes. */
const LgdConstructorOverloadEmitter = {
    /** @description Provides one stable internal entry for each overload without reserving user-visible member names. */
    key(declaration, member, kind = 'initialize')
    {
        return `[Symbol.for("lgd.class.${kind}:${declaration.constructorMembers.indexOf(member)}")]`;
    },

    /** @description Dispatches a public factory or inherited initialization to one already-created method. */
    emitDispatch(output, context, kind)
    {
        const declaration = context.declaration;
        const anchor = declaration.constructorMember.nameStart;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        const args = LgdConstructorSignatures.uniqueName(context.content, '_lgdArguments');
        const key = kind === 'create' ? 'create' : '[Symbol.for("lgd.class.initialize")]';
        const resultType = kind === 'create' ? `typeof ${declaration.name}` : 'void';
        context.syntax.appendGenerated(output, `/** @param {${LgdConstructorSignatures.argumentType(declaration)}} ${args} @returns {${resultType}} */${newline}${indent}${key}(...${args}) {`, anchor);
        for(const signature of LgdConstructorSignatures.get(declaration))
        {
            const target = this.key(declaration, signature.member, kind);
            const condition = LgdConstructorSignatures.condition(signature, `${args}.length`);
            context.syntax.appendGenerated(output, `${newline}${indent}    if(${condition}) return (${declaration.runtimeClassName}${target}).apply(this, ${args});`, anchor);
        }

        const separator = kind === 'create' ? '' : `${newline}${indent}`;
        context.syntax.appendGenerated(output, `${newline}${indent}    throw new TypeError("No matching ${declaration.name} constructor overload.");${newline}${indent}},${separator}`, anchor);
    },

    /** @description Separates member-leading comments from trailing comments on the preceding member. */
    memberPrefixStart(context, member)
    {
        const declaration = context.declaration;
        const index = declaration.classMembers.indexOf(member);
        const previousEnd = index === 0 ? declaration.initializerStart + 1 : declaration.classMembers[index - 1].bodyEnd;
        if(index === 0)
        {
            return previousEnd;
        }

        const prefix = context.content.slice(previousEnd, member.start);
        const trailing = (/^(?:[\t ]*(?:\/\/[^\n\r]*|\/\*(?!\*)[\S\s]*?\*\/))*/).exec(prefix)[0];
        let start = previousEnd + trailing.length;
        if(trailing && context.content[start] === '\r')
        {
            start++;
        }

        if(trailing && context.content[start] === '\n')
        {
            start++;
        }

        return start;
    },

    /** @description Keeps later overload comments beside their branch with exact source-text mappings. */
    emitNativeComments(output, context, member)
    {
        const start = this.memberPrefixStart(context, member);
        const prefix = context.content.slice(start, member.start);
        const firstComment = prefix.search(/\S/);
        if(firstComment === -1)
        {
            return;
        }

        const newline = context.compiler.detectNewline(context.content);
        const indent = `${context.declaration.indent}        `;
        const commentStart = start + firstComment;
        const commentEnd = start + prefix.trimEnd().length;
        const lineStart = context.content.lastIndexOf('\n', commentStart - 1) + 1;
        const margin = context.content.slice(lineStart, commentStart);
        const sourceIndent = (/^[\t ]*$/).test(margin) ? margin : '';
        context.syntax.appendGenerated(output, newline, commentStart);
        let cursor = commentStart;
        while(cursor < commentEnd)
        {
            const nextLine = context.content.indexOf('\n', cursor);
            const end = nextLine === -1 ? commentEnd : Math.min(nextLine + 1, commentEnd);
            const line = context.content.slice(cursor, end);
            if(line.trim())
            {
                if(cursor !== commentStart && line.startsWith(sourceIndent))
                {
                    cursor += sourceIndent.length;
                }

                context.syntax.appendGenerated(output, indent, cursor);
            }

            context.syntax.appendSource(output, context, cursor, end);
            cursor = end;
        }
    },

    /** @description Keeps native super, defaults, arguments, early exits, and lexical constructor bodies in their selected branch. */
    emitNative(output, context)
    {
        const declaration = context.declaration;
        const first = declaration.constructorMember;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        const args = LgdConstructorSignatures.uniqueName(context.content, '_lgdArguments');
        context.syntax.appendGenerated(output, `/** @param {${LgdConstructorSignatures.argumentType(declaration)}} ${args} */${newline}${indent}constructor(...${args}) {`, first.nameStart, {
            end: first.nameEnd, name: { srcStart: first.nameStart, srcEnd: first.nameEnd, outStart: 0, outEnd: 0 }
        });
        for(const signature of LgdConstructorSignatures.get(declaration))
        {
            const member = signature.member;
            const condition = LgdConstructorSignatures.condition(signature, `${args}.length`);
            const type = LgdConstructorSignatures.tuple(signature);
            if(member !== first)
            {
                this.emitNativeComments(output, context, member);
            }

            context.syntax.appendGenerated(output, `${newline}${indent}    if(${condition}) {${newline}${indent}        /** @type {(...args: ${type}) => void} */ (`, member.start);
            context.syntax.appendSource(output, context, member.nameEnd, member.paramEnd);
            context.syntax.appendGenerated(output, ' => {', member.bodyStart, { end: member.bodyStart + 1 });
            if(declaration.baseName)
            {
                context.syntax.appendGenerated(output, `${newline}${indent}            super(`, member.bodyStart);
                if(member.baseArgumentsStart !== null)
                {
                    context.syntax.appendSource(output, context, member.baseArgumentsStart, member.baseArgumentsEnd);
                }

                context.syntax.appendGenerated(output, ');', member.bodyStart);
            }

            LgdClassFields.emitInstanceInitializerCall(output, context, 'this');
            context.syntax.appendSource(output, context, member.bodyStart + 1, member.bodyEnd - 1);
            context.syntax.appendGenerated(output, `${newline}${indent}        })(.../** @type {${type}} */ (${args}));${newline}${indent}        return;${newline}${indent}    }`, member.bodyEnd - 1, { end: member.bodyEnd });
        }

        context.syntax.appendGenerated(output, `${newline}${indent}    throw new TypeError("No matching ${declaration.name} constructor overload.");${newline}${indent}}`, declaration.initializerEnd - 1);
    }
};

module.exports = LgdConstructorOverloadEmitter;
