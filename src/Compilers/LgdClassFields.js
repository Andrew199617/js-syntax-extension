const typeMaps = require('./LgdTypeMaps');
const { splitTopLevelChunks } = require('./LgdTypedParams');

/** @description Parses typed class data fields and emits consistent own-instance and declaring-type static storage. */
const LgdClassFields = {
    /** @description Reads one typed data field with an optional initializer and explicit static ownership. */
    parseField(context)
    {
        const { content, masked, start, declaration, modifiers, compiler } = context;
        const head = new RegExp(`^\\s*(?<type>${typeMaps.typeTokenPattern})\\s+(?<name>[$A-Z_a-z][\\w$]*)\\s*(?<terminator>[;=])`).exec(modifiers.head);
        if(!head)
        {
            return null;
        }

        if(declaration.kind === 'interface' || modifiers.abstractStart !== null || modifiers.virtualStart !== null || modifiers.overrideStart !== null)
        {
            return { error: 'LGD data fields cannot be interface contracts, abstract, virtual, or override.', offset: start };
        }

        if(head.groups.type === 'void' || !typeMaps.parseTypeName(head.groups.type))
        {
            return { error: 'An LGD field requires a supported value type.', offset: start };
        }

        const typeStart = start + head[0].indexOf(head.groups.type);
        const nameStart = start + head[0].lastIndexOf(head.groups.name);
        const delimiter = start + head[0].length - 1;
        const initializerStart = head.groups.terminator === '=' ? delimiter + 1 : null;
        const scan = initializerStart === null ? { end: delimiter } : compiler.scanInitializer(content, initializerStart);
        if(scan.error || scan.end >= declaration.initializerEnd - 1)
        {
            return { error: scan.error || 'A typed field must end with a semicolon inside its class.', offset: start };
        }

        if(initializerStart !== null && masked.slice(initializerStart, scan.end).trim() === '')
        {
            return { error: 'Expected an initializer expression for the typed field.', offset: initializerStart };
        }

        if(initializerStart !== null && splitTopLevelChunks(`(${content.slice(initializerStart, scan.end)})`).length > 1)
        {
            return { error: 'Declare one typed field per semicolon; multiple field declarators are not supported.', offset: initializerStart };
        }

        return { member: {
            name: head.groups.name, kind: 'field', start: start,
            accessibility: modifiers.accessibility, accessibilityStart: modifiers.accessibilityStart,
            accessibilityEnd: modifiers.accessibilityStart === null ? null : modifiers.accessibilityStart + modifiers.accessibility.length,
            nameStart: nameStart, nameEnd: nameStart + head.groups.name.length,
            propertyTypeName: head.groups.type,
            propertyTypeStart: typeStart - declaration.initializerStart,
            propertyTypeEnd: typeStart + head.groups.type.length - declaration.initializerStart,
            initializerStart: initializerStart, initializerEnd: initializerStart === null ? null : scan.end,
            paramStart: nameStart, paramEnd: nameStart, params: [],
            bodyStart: start, bodyEnd: scan.end + 1,
            isConstructor: false, returnTypeName: null,
            returnTypeStart: -1, returnTypeEnd: -1,
            readonly: modifiers.readonlyStart !== null,
            static: modifiers.staticStart !== null, staticStart: modifiers.staticStart,
            staticEnd: modifiers.staticStart === null ? null : modifiers.staticStart + 'static'.length,
            abstract: false, virtual: false, override: false, modifierSpans: modifiers.spans,
            getter: false, setter: false
        } };
    },

    /** @description Supplies C#-style zero defaults without sharing mutable initializer values. */
    fieldDefault(member)
    {
        if(typeMaps.elementTypeName(member.propertyTypeName) !== null && !typeMaps.isNullableType(member.propertyTypeName))
        {
            return '[]';
        }

        if(typeMaps.baseTypeName(member.propertyTypeName) === 'Number' && !typeMaps.isNullableType(member.propertyTypeName))
        {
            return '0';
        }

        if(typeMaps.baseTypeName(member.propertyTypeName) === 'Boolean' && !typeMaps.isNullableType(member.propertyTypeName))
        {
            return 'false';
        }

        if(typeMaps.baseTypeName(member.propertyTypeName) === 'BigInt' && !typeMaps.isNullableType(member.propertyTypeName))
        {
            return '0n';
        }

        return 'null';
    },

    /** @description Maps the declared field name to its emitted own-property definition. */
    appendName(output, context, field)
    {
        context.syntax.appendGenerated(output, field.name, field.nameStart, {
            end: field.nameEnd,
            name: { srcStart: field.nameStart, srcEnd: field.nameEnd, outStart: 0, outEnd: field.name.length }
        });
    },

    /** @description Defines instance fields as own writable data properties on the actual allocated receiver. */
    emitInstanceFields(output, context, receiver)
    {
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${context.declaration.indent}        `;
        const fields = context.declaration.classMembers.filter(member => member.kind === 'field' && !member.static);
        for(const field of fields)
        {
            const type = typeMaps.toTsType(field.propertyTypeName);
            context.syntax.appendGenerated(output, `${newline}${indent}/** @type {${type}} */${newline}${indent}Object.defineProperty(${receiver}, "`, field.start);
            this.appendName(output, context, field);
            context.syntax.appendGenerated(output, '", { value: ', field.nameEnd, { end: field.initializerStart ?? field.bodyEnd });
            context.syntax.appendGenerated(output, this.fieldDefault(field), field.nameStart);
            context.syntax.appendGenerated(output, ', writable: true, enumerable: true, configurable: true });', field.bodyEnd);
        }

        for(const field of fields)
        {
            if(field.initializerStart !== null)
            {
                context.syntax.appendGenerated(output, `${newline}${indent}${receiver}.${field.name} =`, field.nameStart);
                context.syntax.appendSource(output, context, field.initializerStart, field.initializerEnd);
                context.syntax.appendGenerated(output, ';', field.initializerEnd, { end: field.bodyEnd });
            }
        }
    },

    /** @description Chooses declaration-unique type references that cannot collide with source bindings or nested namesakes. */
    runtimeNames(content, name, offset)
    {
        let runtimeClassName = `_lgdClass${name}_${offset}`;
        while(content.includes(runtimeClassName))
        {
            runtimeClassName += '$';
        }

        let runtimeBaseName = `_lgdBaseClass${name}_${offset}`;
        while(content.includes(runtimeBaseName))
        {
            runtimeBaseName += '$';
        }

        return { runtimeClassName: runtimeClassName, runtimeBaseName: runtimeBaseName };
    },

    /** @description Captures declaring type identities outside constructor and method parameter scopes. */
    emitRuntimeAliases(output, context)
    {
        const declaration = context.declaration;
        const newline = context.compiler.detectNewline(context.content);
        context.syntax.appendGenerated(output, `${newline}${declaration.indent}const ${declaration.runtimeClassName} = ${declaration.name};`, declaration.nameStart);
        if(declaration.baseName)
        {
            context.syntax.appendGenerated(output, `${newline}${declaration.indent}const ${declaration.runtimeBaseName} = ${declaration.baseName};`, declaration.baseStart);
        }
    },

    /** @description Separates field initializer lexical scope from constructor parameters and hoisted body locals. */
    emitInstanceInitializer(output, context)
    {
        const declaration = context.declaration;
        const fields = declaration.classMembers.filter(member => member.kind === 'field' && !member.static);
        if(fields.length === 0)
        {
            return;
        }

        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        context.syntax.appendGenerated(output, `${newline}${indent}[Symbol.for("lgd.class.fields")]() {`, declaration.initializerEnd - 1);
        this.emitInstanceFields(output, context, 'this');
        context.syntax.appendGenerated(output, `${newline}${indent}}`, declaration.initializerEnd - 1);
        if(context.backend.objectModel !== 'class')
        {
            context.syntax.appendGenerated(output, ',', declaration.initializerEnd - 1);
        }
    },

    /** @description Runs only the defining class's field initializer on the allocated actual instance. */
    emitInstanceInitializerCall(output, context, receiver)
    {
        const declaration = context.declaration;
        if(!declaration.classMembers.some(member => member.kind === 'field' && !member.static))
        {
            return;
        }

        const newline = context.compiler.detectNewline(context.content);
        const owner = context.backend.objectModel === 'class' ? `${declaration.runtimeClassName}.prototype` : declaration.runtimeClassName;
        context.syntax.appendGenerated(
            output, `${newline}${declaration.indent}        (${owner}[Symbol.for("lgd.class.fields")]).call(${receiver});`,
            declaration.constructorMember?.bodyStart ?? declaration.nameStart
        );
    },

    /** @description Emits one-time static storage whose inherited setters retain the declaring type's cell. */
    emitStaticFields(output, context)
    {
        const declaration = context.declaration;
        const newline = context.compiler.detectNewline(context.content);
        const fields = declaration.classMembers.filter(member => member.kind === 'field' && member.static);
        for(const field of fields)
        {
            let cell = `_lgdStatic${declaration.name}_${field.name}`;
            while(context.content.includes(cell))
            {
                cell += '$';
            }

            field.staticStorageName = cell;
            const type = typeMaps.toTsType(field.propertyTypeName);
            context.syntax.appendGenerated(output, `${newline}${declaration.indent}/** @type {${type}} */${newline}${declaration.indent}let ${cell} = ${this.fieldDefault(field)};`
                + `${newline}${declaration.indent}Object.defineProperty(${declaration.name}, "`, field.start);
            this.appendName(output, context, field);
            context.syntax.appendGenerated(
                output, `", { get() { return ${cell}; }, set(value) { ${cell} = value; }, enumerable: true, configurable: false });`,
                field.nameEnd, { end: field.initializerStart ?? field.bodyEnd }
            );
        }

        for(const field of fields)
        {
            if(field.initializerStart !== null)
            {
                context.syntax.appendGenerated(output, `${newline}${declaration.indent}${field.staticStorageName} =`, field.nameStart);
                context.syntax.appendSource(output, context, field.initializerStart, field.initializerEnd);
                context.syntax.appendGenerated(output, ';', field.initializerEnd, { end: field.bodyEnd });
            }
        }
    }
};

module.exports = LgdClassFields;
