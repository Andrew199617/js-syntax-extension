const LgdAccessibility = require('../Compilers/LgdAccessibility');
const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');
const { visibleBindings } = require('../Compilers/LgdBaseChecker');

/** @description Filters completion candidates using the same lexical ownership rules as compilation. */
const LgdAccessibilityEditor = {
    /** @description Resolves a source receiver even while its incomplete member expression cannot form JavaScript. */
    filter(state, position, name, members)
    {
        if(!state)
        {
            return members;
        }

        const offset = state.document.offsetAt(position);
        const context = { content: state.document.getText(), declarations: state.declarations, externals: state.externals || new Map() };
        const registry = LgdClassMemberSemantics.create(context);
        const lexicalOwner = LgdAccessibility.lexicalOwner(offset, context.declarations);
        let receiver;
        if(name === 'this')
        {
            receiver = lexicalOwner && { declaration: lexicalOwner, kind: 'instance' };
        }
        else
        {
            const binding = visibleBindings(registry._bindings, offset).get(name);
            if(binding?.kind === 'class')
            {
                receiver = { declaration: binding, kind: 'type' };
            }
            else
            {
                const type = binding?.typeName && registry._type(binding.typeName, offset, binding);
                receiver = type && { declaration: type, kind: 'instance' };
            }
        }

        const options = { registry: registry, lexicalOwner: lexicalOwner, receiver: receiver, projectId: state.projectId };
        if(receiver && !LgdAccessibility.allowed(LgdAccessibility.visibility(receiver.declaration), receiver.declaration, options))
        {
            return [];
        }

        const known = receiver ? registry.members(receiver.declaration) : [];
        return members.filter(candidate =>
        {
            const member = known.find(entry => entry.name === candidate.name) || candidate;
            const owner = LgdAccessibility.memberOwner(member, registry);
            const accesses = [member.accessibility || 'public'];
            if(member.accessor)
            {
                accesses.splice(0, 1, ...[ member.getterAccessibility, member.setterAccessibility ].filter(Boolean));
            }

            return accesses.some(accessibility => LgdAccessibility.allowed(accessibility, owner, { ...options, isConstructor: member.name === 'create' }));
        });
    }
};

module.exports = LgdAccessibilityEditor;
