const typeMaps = require('./LgdTypeMaps');
const LgdConstructorSignatures = require('./LgdConstructorSignatures');
const LgdConstructorOverloadEmitter = require('./LgdConstructorOverloadEmitter');
const LgdClassFields = require('./LgdClassFields');

/** @description Keeps allocation and C#-ordered initialization separate without changing the create caller API. */
const LgdClassConstructorEmitter = {
    /** @description Keeps parameter erasure while documenting the generated constructor initializer separately. */
    runtimeGroup(group, protocolConstructor)
    {
        if(group.name === 'create' && protocolConstructor)
        {
            return { ...group, methodStart: undefined };
        }

        return group;
    },

    /** @description Allocates once and initializes each LGD level on the same receiver before its constructor body. */
    emit(output, context, member)
    {
        const declaration = context.declaration;
        const anchor = member ? member.start : declaration.nameStart;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        let instanceName = '_lgdInstance';
        let argumentsName = '_lgdArguments';
        while(context.content.includes(instanceName))
        {
            instanceName += '$';
        }

        while(context.content.includes(argumentsName))
        {
            argumentsName += '$';
        }

        const tuple = (member?.params || []).map(parameter =>
        {
            const type = typeMaps.toTsType(parameter.typeName) || 'any';
            if(parameter.rest)
            {
                const elementType = typeMaps.isNullableType(parameter.typeName) ? `(${type})` : type;
                return `...${parameter.name}: ${elementType}[]`;
            }

            const optional = parameter.defaultText !== null && parameter.defaultText !== undefined ? '?' : '';
            return `${parameter.name}${optional}: ${type}`;
        }).join(', ');

        const overloaded = declaration.constructorMembers?.length > 1;
        if(!overloaded || member === declaration.constructorMember)
        {
            context.syntax.appendGenerated(output, `${newline}${indent}/**${newline}${indent} * @param {${overloaded ? LgdConstructorSignatures.argumentType(declaration) : `[${tuple}]`}} ${argumentsName}${newline}${indent} * @returns {typeof ${declaration.name}}${newline}${indent} */${newline}${indent}`, anchor);
            context.syntax.appendGenerated(output, 'create', member ? member.nameStart : anchor, {
                end: member ? member.nameEnd : anchor,
                name: { srcStart: member ? member.nameStart : anchor, srcEnd: member ? member.nameEnd : anchor, outStart: 0, outEnd: 'create'.length }
            });
            context.syntax.appendGenerated(output, `(...${argumentsName}) {${newline}${indent}    const ${instanceName} = `, anchor);
            if(declaration.baseName)
            {
                context.syntax.appendGenerated(output, 'Oloo.assign(Object.create(', anchor);
                context.syntax.appendGenerated(output, declaration.baseName, declaration.baseStart, {
                    end: declaration.baseEnd,
                    name: { srcStart: declaration.baseStart, srcEnd: declaration.baseEnd, outStart: 0, outEnd: declaration.baseName.length }
                });
                context.syntax.appendGenerated(output, `), ${declaration.name});`, declaration.baseEnd, { end: declaration.initializerStart + 1 });
            }
            else
            {
                context.syntax.appendGenerated(output, `Object.create(${declaration.name});`, anchor);
            }

            context.syntax.appendGenerated(output, `${newline}${indent}    (${declaration.runtimeClassName}[Symbol.for("lgd.class.initialize")]).apply(${instanceName}, ${argumentsName});`
                + `${newline}${indent}    return ${instanceName};${newline}${indent}},${newline}${indent}`, anchor);
            if(overloaded)
            {
                LgdConstructorOverloadEmitter.emitDispatch(output, context, 'initialize');
            }
        }

        if(member)
        {
            const parameters = member.params.filter(parameter => parameter.typeName).map(parameter =>
            {
                const type = typeMaps.toTsType(parameter.typeName);
                const elementType = typeMaps.isNullableType(parameter.typeName) ? `(${type})` : type;
                const annotated = parameter.rest ? `...${elementType}` : type;
                return `${indent} * @param {${annotated}} ${parameter.name}`;
            });

            if(parameters.length > 0)
            {
                context.syntax.appendGenerated(output, `/**${newline}${parameters.join(newline)}${newline}${indent} */${newline}${indent}`, member.nameEnd);
            }

            context.syntax.appendGenerated(output, overloaded ? LgdConstructorOverloadEmitter.key(declaration, member) : '[Symbol.for("lgd.class.initialize")]', member.nameEnd);
            context.syntax.appendSource(output, context, member.nameEnd, member.paramEnd);
        }
        else
        {
            context.syntax.appendGenerated(output, '[Symbol.for("lgd.class.initialize")]()', anchor);
        }

        context.syntax.appendGenerated(output, ' {', member ? member.bodyStart : anchor, { end: member ? member.bodyStart + 1 : anchor });
        LgdClassFields.emitInstanceInitializerCall(output, context, 'this');
        if(declaration.baseName)
        {
            context.syntax.appendGenerated(output, `${newline}${indent}    (${declaration.runtimeBaseName}[Symbol.for("lgd.class.initialize")]).call(this`, anchor);
            if(member && member.baseArgumentsStart !== null && context.content.slice(member.baseArgumentsStart, member.baseArgumentsEnd).trim())
            {
                context.syntax.appendGenerated(output, ', ', member.baseArgumentsStart);
                context.syntax.appendSource(output, context, member.baseArgumentsStart, member.baseArgumentsEnd);
            }

            context.syntax.appendGenerated(output, ');', anchor);
        }

        if(member)
        {
            context.syntax.appendSource(output, context, member.bodyStart + 1, member.bodyEnd - 1);
        }

        context.syntax.appendGenerated(output, `${newline}${indent}}`, member ? member.bodyEnd - 1 : anchor, { end: member ? member.bodyEnd : anchor });
    }
};

module.exports = LgdClassConstructorEmitter;
