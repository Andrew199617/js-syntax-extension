const ConvertObjectInheritanceFix = require('./ConvertObjectInheritanceFix');
const LgdFactoryMigration = require('../../Compilers/LgdFactoryMigration');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Renames an ordinary constructor only when the complete class preview remains valid. */
class RenameClassConstructorFix extends ConvertObjectInheritanceFix
{
    /** @description Registers the separate spelling action while sharing class-preview validation. */
    constructor()
    {
        super();
        this.kind = 'renameClassConstructor';
    }

    /** @description Preserves the signature and body while rejecting duplicate or factory-style constructors. */
    createProposal(context, fix)
    {
        const { source, state, document, languageService, snapshots } = context;
        const compiler = LgdCompiler.create();
        const parsed = compiler.parse(source.text, state.externals);
        const declaration = parsed.declarations.find(candidate => candidate.start === fix.declarationStart && candidate.name === fix.name);
        if(fix.kind !== this.kind || declaration?.kind !== 'class' || declaration.constructorMember)
        {
            return null;
        }

        if(this._documentedBase(declaration) || LgdFactoryMigration.read(source.text, declaration, parsed.allDeclarations)?.factory)
        {
            return super.createProposal(context, { ...fix, kind: 'convertObjectInheritance' });
        }

        const candidates = declaration.classMembers.filter(member => member.name === 'constructor' || member.name === 'create');
        const member = candidates[0];
        const unsupported = member && (member.modifierSpans.length > 0 || member.async || member.generator || member.accessor || member.returnTypeName);
        if(candidates.length !== 1 || member.name !== 'constructor' || member.start !== fix.memberStart || unsupported)
        {
            return null;
        }

        const options = languageService.getOutputOptions(document);
        const previewText = source.text.slice(0, member.nameStart) + declaration.name + source.text.slice(member.nameEnd);
        const preview = compiler.compileToJs(previewText, state.externals, options);
        const original = compiler.compileToJs(source.text, state.externals, options);
        const delta = declaration.name.length - (member.nameEnd - member.nameStart);
        if(!this._validErrors(original.errors, preview, declaration, delta))
        {
            return null;
        }

        const signature = JSON.stringify(options);
        return { title: `Rename constructor to '${declaration.name}'`, target: source, snapshots: snapshots,
            offset: member.nameStart, endOffset: member.nameEnd, newText: declaration.name,
            validate: () => JSON.stringify(languageService.getOutputOptions(document)) === signature };
    }
}

module.exports = RenameClassConstructorFix;
