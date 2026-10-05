const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdObjectInheritance = require('../../Compilers/LgdObjectInheritance');
const LgdDocComment = require('../../Compilers/LgdDocComment');

/** @description Removes only attached heritage tags that repeat the class's explicit LGD base. */
class RemoveInheritanceDocFix extends DiagnosticQuickFix
{
    constructor() { super('removeInheritanceDoc', true); }

    /** @description Revalidates the declaration and reuses ordinary fence-aware documentation cleanup. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        if(fix.kind !== this.kind)
        {
            return null;
        }

        const checked = LgdCompiler.create().parse(source.text, state.externals);
        const declaration = checked.allDeclarations.find(candidate => candidate.start === fix.declarationStart && candidate.name === fix.name);
        if(!declaration || declaration.baseName !== fix.baseTypeName)
        {
            return null;
        }

        const tags = LgdObjectInheritance.redundantTags(declaration);
        if(tags.length === 0 || !tags.some(tag => tag.baseTypeName === fix.baseTypeName))
        {
            return null;
        }

        const attachment = { commentStart: declaration.start, commentEnd: declaration.start + declaration.jsdoc.length, memberStart: declaration.headStart };
        const edit = LgdDocComment.edit(source.text, attachment, tags);
        return { title: 'Remove redundant inheritance documentation', target: source, snapshots: snapshots, ...edit };
    }
}

module.exports = RemoveInheritanceDocFix;
