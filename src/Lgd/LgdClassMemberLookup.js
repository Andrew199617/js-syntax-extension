const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');

/** @description Resolves declared class fields and members for source-backed hover and definition navigation. */
const LgdClassMemberLookup = {
    /** @description Resolves one current source declaration or access through the shared lexical class member model. */
    get(state, position)
    {
        if(!state.jsDocument || state.compiledText !== state.document.getText() || state.compiledVersion !== state.document.version)
        {
            return null;
        }

        const content = state.document.getText();
        const sourceOffset = state.document.offsetAt(position);
        const context = { content: content, declarations: state.declarations, externals: state.externals || new Map(), map: state.map };
        const registry = LgdClassMemberSemantics.create(context);
        for(const declaration of state.declarations)
        {
            const field = declaration.classMembers?.find(member => member.kind === 'field' && member.nameStart <= sourceOffset && sourceOffset < member.nameEnd);
            if(field)
            {
                return registry.members(declaration).find(member => member.name === field.name) || null;
            }
        }

        let syntax;
        try
        {
            syntax = parse(state.jsDocument.getText(), { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            return null;
        }

        context.tree = syntax;
        const offset = state.map.toOutput(sourceOffset);
        let target = null;
        function inspectMember(path)
        {
            const property = path.node.property;
            if(offset < property.start || offset >= property.end)
            {
                return;
            }

            const resolved = registry.resolve(path);
            if(resolved?.valid)
            {
                target = resolved.member;
                path.stop();
            }
        }

        traverse(syntax, { MemberExpression: inspectMember, OptionalMemberExpression: inspectMember });
        return target;
    }
};

module.exports = LgdClassMemberLookup;
