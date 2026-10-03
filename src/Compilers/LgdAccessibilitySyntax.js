const { typeTokenPattern, baseTypeName } = require('./LgdTypeMaps');

/** @description Parses type visibility and signature-only property accessors while preserving source offsets. */
const LgdAccessibilitySyntax = {
    /** @description Shares exact visibility spans between fields, methods, constructors, and property contracts. */
    accessibilityMetadata(modifiers)
    {
        return { accessibility: modifiers.accessibility, accessibilityStart: modifiers.accessibilityStart,
            accessibilityEnd: modifiers.accessibilityStart === null ? null : modifiers.accessibilityStart + modifiers.accessibility.length };
    },

    /** @description Validates declaration modifiers without changing offsets or the existing public default. */
    readDeclarationModifiers(prefix, start)
    {
        const result = { accessibility: 'public', accessibilityStart: null, abstractStart: null };
        for(const match of prefix.matchAll(/\b(?<modifier>abstract|public|private|protected|internal|static|sealed|partial)\b/g))
        {
            const modifier = match.groups.modifier;
            const offset = start + match.index;
            const endOffset = offset + modifier.length;
            if(modifier === 'abstract' && result.abstractStart === null)
            {
                result.abstractStart = offset;
            }
            else if([ 'public', 'internal' ].includes(modifier) && result.accessibilityStart === null)
            {
                result.accessibility = modifier;
                result.accessibilityStart = offset;
            }
            else
            {
                const message = [ 'private', 'protected' ].includes(modifier)
                    ? 'LGD type declarations support public or internal accessibility.'
                    : `The '${modifier}' declaration modifier is not supported here or conflicts with an earlier modifier.`;

                return { error: message, offset: offset, endOffset: endOffset, code: 'lgd.syntax.declarationModifier' };
            }
        }

        return result;
    },

    /** @description Reads a typed signature-only property with one or both accessor contracts. */
    parsePropertyContract(masked, start, declaration, modifiers)
    {
        const head = new RegExp(`^\\s*(?<type>${typeTokenPattern})\\s+(?<name>[$A-Z_a-z][\\w$]*)\\s*{`).exec(modifiers.head);
        if(!head)
        {
            return null;
        }

        const contract = declaration.kind === 'interface' || modifiers.abstractStart !== null;
        if(!contract || declaration.kind !== 'interface' && !declaration.abstract)
        {
            return { error: 'Signature-only properties require an interface or an abstract member in an abstract class.', offset: start };
        }

        if(modifiers.virtualStart !== null || baseTypeName(head.groups.type) === 'void')
        {
            return { error: 'A property contract must have a value type and cannot explicitly be virtual.', offset: start };
        }

        if(declaration.kind === 'interface' && modifiers.overrideStart !== null)
        {
            return { error: 'An interface property contract cannot be override.', offset: modifiers.overrideStart };
        }

        const bodyStart = start + head[0].length - 1;
        const close = this.findClose(masked, bodyStart);
        if(close === -1 || close >= declaration.initializerEnd - 1)
        {
            return { error: 'Unclosed LGD property contract.', offset: bodyStart };
        }

        const accessors = {};
        let cursor = this.skipSpace(masked, bodyStart + 1);
        while(cursor < close)
        {
            const accessor = (/^(?:(?<accessibility>public|private|protected|internal)\s+)?(?<kind>get|set)\b/).exec(masked.slice(cursor));
            if(!accessor)
            {
                return { error: 'A property contract supports only "get;" and "set;" accessors without bodies.', offset: cursor };
            }

            const accessorKind = accessor.groups.kind;
            if(accessors[accessorKind])
            {
                return { error: `Duplicate '${accessorKind}' property accessor.`, offset: cursor };
            }

            const access = accessor.groups.accessibility;
            if(access)
            {
                const parent = modifiers.accessibility;
                const narrower = access === 'private' && parent !== 'private' || parent === 'public' && [ 'protected', 'internal' ].includes(access);
                if(!narrower || declaration.kind === 'interface' || access === 'private')
                {
                    return { error: 'An abstract accessor requires protected or internal accessibility that is more restrictive than its property.',
                        offset: cursor, endOffset: cursor + access.length, code: 'lgd.access.accessor' };
                }

                modifiers.spans.push({ start: cursor, end: cursor + access.length });
            }

            const accessorStart = cursor + accessor[0].length - accessorKind.length;
            accessors[accessorKind] = { start: accessorStart, end: accessorStart + accessorKind.length, accessibility: access };
            cursor = this.skipSpace(masked, cursor + accessor[0].length);
            if(masked[cursor] !== ';')
            {
                return { error: 'Property contract accessors must end with ";" and cannot have bodies.', offset: cursor };
            }

            cursor = this.skipSpace(masked, cursor + 1);
        }

        if(!accessors.get && !accessors.set)
        {
            return { error: 'A property contract requires at least one get or set accessor.', offset: bodyStart };
        }

        const restricted = Object.values(accessors).filter(accessor => accessor.accessibility);
        if(restricted.length > 0 && (!accessors.get || !accessors.set || restricted.length > 1))
        {
            return { error: 'A property with two accessors can restrict exactly one accessor.', offset: bodyStart, endOffset: close + 1, code: 'lgd.access.accessor' };
        }

        const nameEnd = masked.slice(0, bodyStart).trimEnd().length;
        const typeStart = start + head[0].indexOf(head.groups.type);
        return { member: {
            name: head.groups.name,
            ...this.accessibilityMetadata(modifiers),
            kind: 'property',
            start: start,
            nameStart: nameEnd - head.groups.name.length,
            nameEnd: nameEnd,
            paramStart: nameEnd,
            paramEnd: nameEnd,
            params: [],
            bodyStart: bodyStart,
            bodyEnd: close + 1,
            baseArgumentsStart: null,
            baseArgumentsEnd: null,
            isConstructor: false,
            returnTypeName: null,
            returnTypeStart: -1,
            returnTypeEnd: -1,
            propertyTypeName: head.groups.type,
            propertyTypeStart: typeStart - declaration.initializerStart,
            propertyTypeEnd: typeStart + head.groups.type.length - declaration.initializerStart,
            async: false,
            generator: false,
            accessor: true,
            accessorKind: null,
            getter: Boolean(accessors.get),
            setter: Boolean(accessors.set),
            getterAccessibility: accessors.get?.accessibility || modifiers.accessibility,
            setterAccessibility: accessors.set?.accessibility || modifiers.accessibility,
            getterStart: accessors.get ? accessors.get.start : null,
            getterEnd: accessors.get ? accessors.get.end : null,
            setterStart: accessors.set ? accessors.set.start : null,
            setterEnd: accessors.set ? accessors.set.end : null,
            abstract: true,
            abstractStart: modifiers.abstractStart,
            abstractEnd: modifiers.abstractStart === null ? null : modifiers.abstractStart + 'abstract'.length,
            virtual: true,
            override: modifiers.overrideStart !== null,
            virtualStart: null,
            virtualEnd: null,
            overrideStart: modifiers.overrideStart,
            overrideEnd: modifiers.overrideStart === null ? null : modifiers.overrideStart + 'override'.length,
            modifierSpans: modifiers.spans
        } };
    }
};

module.exports = LgdAccessibilitySyntax;
