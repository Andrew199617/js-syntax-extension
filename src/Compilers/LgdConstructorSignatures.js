const typeMaps = require('./LgdTypeMaps');
const { splitTopLevelChunks } = require('./LgdTypedParams');
const { maskCode } = require('./LgdInfer');

/** @description Shares constructor signatures and argument-count selection across checking, emission, and editor metadata. */
const LgdConstructorSignatures = {
    /** @description Retains all explicit constructors and the implicit public zero-argument constructor. */
    get(declaration)
    {
        if(Array.isArray(declaration.constructorSignatures))
        {
            return declaration.constructorSignatures.map(signature => this.describe(signature.params, signature));
        }

        const members = declaration.constructorMembers || (declaration.constructorMember ? [declaration.constructorMember] : []);
        if(members.length > 0)
        {
            return members.map(member => this.describe(member.params, { member: member, accessibility: member.accessibility || 'public' }));
        }

        return [this.describe(declaration.constructorParams || [], { accessibility: declaration.constructorAccessibility || 'public' })];
    },

    /** @description Computes the inclusive accepted argument-count interval once for each signature. */
    describe(parameters, metadata = {})
    {
        const params = parameters.filter(parameter => parameter.name || maskCode(parameter.raw || '').trim()).map(parameter =>
        {
            if(parameter.name)
            {
                return parameter;
            }

            const raw = maskCode(parameter.raw || '').trim();
            const optional = (/^(?:{[\S\s]*}|\[[\S\s]*])\s*=/).test(raw);
            return { ...parameter, optional: parameter.optional || optional, rest: parameter.rest || raw.startsWith('...') };
        });

        let minimum = 0;
        for(let index = 0; index < params.length; index++)
        {
            const parameter = params[index];
            if(!parameter.rest && !parameter.optional && (parameter.defaultText === null || parameter.defaultText === undefined))
            {
                minimum = index + 1;
            }
        }

        const maximum = params.some(parameter => parameter.rest) ? Infinity : params.length;
        return { ...metadata, params: params, minimum: minimum, maximum: maximum };
    },

    /** @description Selects a uniquely applicable argument count without runtime type tests. */
    select(declaration, count)
    {
        const matches = this.get(declaration).filter(signature => this.accepts(signature, count));
        return matches.length === 1 ? matches[0] : null;
    },

    /** @description Resolves a fixed-count base initializer without guessing spread lengths. */
    selectBase(declaration, member, content)
    {
        const signatures = this.get(declaration);
        if(signatures.length === 1)
        {
            return signatures[0];
        }

        const source = Number.isInteger(member?.baseArgumentsStart) ? content.slice(member.baseArgumentsStart, member.baseArgumentsEnd) : '';
        const args = splitTopLevelChunks(`(${source})`).filter(chunk => maskCode(chunk.text).trim());
        if(args.some(chunk => maskCode(chunk.text).trim().startsWith('...')))
        {
            return null;
        }

        return this.select(declaration, args.length);
    },

    accepts(signature, count) { return signature.minimum <= count && count <= signature.maximum; },

    /** @description Serializes source-independent signature metadata for imported classes. */
    describeAll(declaration)
    {
        return this.get(declaration).map(signature => ({ accessibility: signature.accessibility,
            params: signature.params.map(parameter => ({ name: parameter.name, typeName: parameter.typeName,
                rest: Boolean(parameter.rest), optional: Boolean(parameter.optional), defaultText: parameter.defaultText ?? null })) }));
    },

    /** @description Rejects duplicates and overlapping counts before either backend can choose an incorrect body. */
    check(declaration)
    {
        const signatures = this.get(declaration);
        const errors = [];
        for(let index = 1; index < signatures.length; index++)
        {
            const signature = signatures[index];
            const previous = signatures.slice(0, index).find(candidate => Math.max(candidate.minimum, signature.minimum) <= Math.min(candidate.maximum, signature.maximum));
            if(!previous)
            {
                continue;
            }

            const duplicate = this.shape(previous) === this.shape(signature);
            const sameArity = previous.minimum === previous.maximum && signature.minimum === signature.maximum;
            let message = `Constructor overloads for '${declaration.name}' accept overlapping argument counts. Use non-overlapping parameter counts, including defaults and rest parameters.`;
            let code = 'lgd.constructor.overlappingOverloads';
            if(duplicate)
            {
                message = `Duplicate constructor signature for '${declaration.name}'. Remove or change this constructor.`;
                code = 'lgd.constructor.duplicateOverload';
            }
            else if(sameArity)
            {
                message = `Constructor overloads distinguished only by parameter types are not supported. Give '${declaration.name}' overloads different argument counts.`;
                code = 'lgd.constructor.typeOnlyOverload';
            }

            errors.push({ offset: signature.member.nameStart, endOffset: signature.member.nameEnd, message: message, code: code, category: 'syntax' });
        }

        return errors;
    },

    /** @description Compares signature identity without treating parameter names or default values as overload distinctions. */
    shape(signature)
    {
        return signature.params.map(parameter =>
        {
            const optional = parameter.optional || parameter.defaultText !== null && parameter.defaultText !== undefined;
            return `${parameter.rest ? '...' : ''}${parameter.typeName || '*'}${optional ? '?' : ''}`;
        }).join(',');
    },

    /** @description Formats a named argument tuple for generated JSDoc without adding executable type checks. */
    tuple(signature)
    {
        return `[${signature.params.map(parameter =>
        {
            const type = typeMaps.toTsType(parameter.typeName) || 'any';
            if(parameter.rest)
            {
                const element = typeMaps.isNullableType(parameter.typeName) ? `(${type})` : type;
                return `...${parameter.name}: ${element}[]`;
            }

            const optional = parameter.optional || parameter.defaultText !== null && parameter.defaultText !== undefined ? '?' : '';
            return `${parameter.name}${optional}: ${type}`;
        }).join(', ')}]`;
    },

    /** @description Describes every supported call shape in one generated factory parameter. */
    argumentType(declaration) { return this.get(declaration).map(signature => this.tuple(signature)).join(' | '); },

    /** @description Emits only argument-count comparisons for public JavaScript entry points. */
    condition(signature, count)
    {
        if(signature.minimum === signature.maximum)
        {
            return `${count} === ${signature.minimum}`;
        }

        if(signature.maximum === Infinity)
        {
            return `${count} >= ${signature.minimum}`;
        }

        return `${count} >= ${signature.minimum} && ${count} <= ${signature.maximum}`;
    },

    /** @description Reserves a generated local without shadowing source references. */
    uniqueName(content, name)
    {
        let result = name;
        while(content.includes(result))
        {
            result += '$';
        }

        return result;
    }
};

module.exports = LgdConstructorSignatures;
