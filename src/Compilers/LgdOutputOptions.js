/** @description Resolves implemented output targets without depending on editor configuration. */
const LgdOutputOptions = {
    /** @description Blocks newer class field/static semantics in legacy output backends. */
    checkMemberTarget(compiler, content, parsed)
    {
        for(const declaration of parsed.allDeclarations)
        {
            const unsupported = declaration.classMembers?.some(member => member.kind === 'field' || member.static);
            if(unsupported)
            {
                parsed.errors.push({ ...compiler.createError(
                    content, declaration.nameStart,
                    'Declared class fields and static members are supported only by the JavaScript OLOO and native-class output targets.', declaration.nameEnd
                ),
                code: 'lgd.output.memberTarget', category: 'compilation' });
            }
        }
    },


    /** @description Validates output options, retaining safe defaults for invalid settings. */
    resolve(options = {})
    {
        const resolved = { outputTarget: 'javascript', javascriptObjectModel: 'oloo' };
        const errors = [];
        if(!options || typeof options !== 'object' || Array.isArray(options))
        {
            errors.push({ code: 'lgd.output.options', message: 'Output options must be an object.' });
            return { options: resolved, errors: errors };
        }

        if(options.outputTarget !== undefined && options.outputTarget !== 'javascript')
        {
            errors.push({ code: 'lgd.output.target',
                message: `Unsupported output target '${String(options.outputTarget)}'. Only JavaScript output is available.` });
        }

        if(options.javascriptObjectModel !== undefined)
        {
            if(options.javascriptObjectModel === 'oloo' || options.javascriptObjectModel === 'class')
            {
                resolved.javascriptObjectModel = options.javascriptObjectModel;
            }
            else
            {
                errors.push({ code: 'lgd.output.objectModel',
                    message: `Unsupported JavaScript object model '${String(options.javascriptObjectModel)}'. Choose 'oloo' or 'class'.` });
            }
        }

        return { options: resolved, errors: errors };
    }
};

module.exports = LgdOutputOptions;
