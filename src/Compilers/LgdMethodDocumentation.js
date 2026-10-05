const { maskCode } = require('./LgdInfer');
const LgdDocComment = require('./LgdDocComment');

/** @description Resolves method prose separately from LGD signature types and runtime inheritance. */
const LgdMethodDocumentation = {
    /** @description Attaches effective prose to runtime method groups without changing source comments or signature types. */
    prepare(declarations, registry)
    {
        for(const declaration of declarations.filter(candidate => candidate.kind === 'class'))
        {
            const members = registry.members(declaration);
            declaration.methodDocumentation = (declaration.classMembers || []).filter(member => member.kind === 'method' && !member.isConstructor && !member.abstract)
                .map(member => ({ methodStart: member.start - declaration.initializerStart, params: member.params || [],
                    documentation: members.find(candidate => candidate.name === member.name)?.documentation }));
        }
    },

    /** @description Indexes real attached JSDoc comments, excluding strings and executable examples. */
    attachments(content)
    {
        const comments = [];
        maskCode(content, true, comments);
        return new Map(comments.filter(comment => content.startsWith('/**', comment.start))
            .map(comment => [ comment.end, comment ]));
    },

    /** @description Reads the nearest docblock attached directly to a class member. */
    own(content, member, attachments)
    {
        let end = member.start;
        while(end > 0 && (/\s/).test(content[end - 1]))
        {
            end--;
        }

        const attachment = attachments.get(end);
        return this.parse(attachment ? content.slice(attachment.start, attachment.end) : '/** */');
    },

    /** @description Splits documentation into summary and block tags without interpreting fenced examples. */
    sections(comment)
    {
        const directives = new Set(LgdDocComment.lines(comment).filter(line => (/^@[A-Za-z]/).test(line.text)).map(line => line.offset));
        const sections = [{ tag: '', text: '' }];
        let offset = '/**'.length;
        for(const line of comment.slice(offset, -'*/'.length).split(/(?<=\n)/))
        {
            const prefix = (/^[\t ]*\*?[\t ]*/).exec(line)[0];
            const text = line.slice(prefix.length).replace(/\r?\n$/, '');
            const directive = directives.has(offset + prefix.length) && (/^@(?<tag>[A-Za-z]+)\b(?<body>[\S\s]*)/).exec(text);
            if(directive)
            {
                sections.push({ tag: directive.groups.tag, text: directive.groups.body.trim() });
            }
            else
            {
                sections[sections.length - 1].text += `\n${text}`;
            }

            offset += line.length;
        }

        return sections.map(section => ({ ...section, text: section.text.trim() }));
    },

    /** @description Removes an optional balanced JSDoc type without consuming the authored prose. */
    withoutType(text)
    {
        if(!text.startsWith('{'))
        {
            return text;
        }

        let depth = 0;
        for(let index = 0; index < text.length; index++)
        {
            if(text[index] === '{')
            {
                depth++;
            }
            else if(text[index] === '}' && --depth === 0)
            {
                return text.slice(index + 1).trim();
            }
        }

        return text;
    },

    /** @description Extracts description, parameter and return prose while retaining unrelated tags for emission. */
    parse(comment)
    {
        const sections = this.sections(comment);
        const documentation = { description: sections[0].text, params: Object.create(null), returns: '',
            inherit: sections.some(section => [ 'inheritdoc', 'inheritDoc' ].includes(section.tag)),
            authored: LgdDocComment.hasContent(comment) };
        for(const section of sections)
        {
            if([ 'description', 'desc' ].includes(section.tag) && section.text)
            {
                documentation.description = section.text;
            }
            else if(section.tag === 'param')
            {
                const parameter = (/^(?<name>\[[^\]]+]|\S+)(?:\s+(?:-\s*)?(?<prose>[\S\s]*))?$/).exec(this.withoutType(section.text));
                if(parameter)
                {
                    const name = parameter.groups.name.replace(/^\[/, '').replace(/(?:=.*)?]$/, '');
                    documentation.params[name] = parameter.groups.prose || '';
                }
            }
            else if([ 'return', 'returns' ].includes(section.tag))
            {
                documentation.returns = this.withoutType(section.text).replace(/^-\s*/, '');
            }
        }

        return documentation;
    },

    /** @description Resolves explicit or undocumented inheritance from a matching instance method, remapping parameters by position. */
    resolve(own, member, base)
    {
        const inherited = base?.documentation;
        if(own.authored && !own.inherit || !inherited || member.kind !== 'method' || member.static || member.accessor || base.static || base.kind !== 'method' || base.accessor)
        {
            return own;
        }

        const params = Object.create(null);
        for(const [ index, parameter ] of (member.params || []).entries())
        {
            const previousName = base.params?.[index]?.name;
            params[parameter.name] = this.parameterDescription(inherited, previousName);
        }

        return { description: inherited.description, params: params, returns: inherited.returns, inherited: true, inherit: own.inherit };
    },

    /** @description Reads only authored string prose, including names shared with Object prototype properties. */
    parameterDescription(documentation, name)
    {
        const params = documentation.params;
        if(!params || !Object.prototype.hasOwnProperty.call(params, name))
        {
            return '';
        }

        return typeof params[name] === 'string' ? params[name] : '';
    },

    /** @description Supplements generated JSDoc with resolved prose while preserving authored tags and signature types. */
    merge(comment, documentation, indent, newline)
    {
        if(!documentation)
        {
            return comment;
        }

        const sections = documentation.inherited ? [{ tag: '', text: '' }] : this.sections(comment);
        const own = documentation.inherited ? { params: {}, returns: '' } : this.parse(comment);
        const output = [];
        if(documentation.description)
        {
            output.push(documentation.description);
        }

        const seen = new Set();
        let returns = false;
        for(const section of sections.slice(1))
        {
            if([ 'description', 'desc', 'inheritdoc', 'inheritDoc' ].includes(section.tag))
            {
                continue;
            }

            let text = section.text;
            if(section.tag === 'param')
            {
                const name = (/^(?<name>\[[^\]]+]|\S+)/).exec(this.withoutType(text))?.groups.name.replace(/^\[/, '').replace(/(?:=.*)?]$/, '');
                seen.add(name);
                if(name && !this.parameterDescription(own, name) && this.parameterDescription(documentation, name))
                {
                    text += ` ${this.parameterDescription(documentation, name)}`;
                }
            }
            else if([ 'return', 'returns' ].includes(section.tag))
            {
                returns = true;
                if(!own.returns && documentation.returns)
                {
                    text += ` ${documentation.returns}`;
                }
            }

            output.push(`@${section.tag} ${text}`.trimEnd());
        }

        for(const [ name, prose ] of Object.entries(documentation.params))
        {
            if(prose && !seen.has(name))
            {
                output.push(`@param ${name} ${prose}`);
            }
        }

        if(!returns && documentation.returns)
        {
            output.push(`@returns ${documentation.returns}`);
        }

        if(output.length === 0)
        {
            return '/** */';
        }

        return [ '/**', ...output.join('\n').split('\n').map(line => `${indent} * ${line}`), `${indent} */` ].join(newline);
    }
};

module.exports = LgdMethodDocumentation;
