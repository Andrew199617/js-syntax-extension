const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdVirtualDocChecker = require('../../Compilers/LgdVirtualDocChecker');

/** @description Migrates legacy virtual documentation with a single guarded, source-preserving edit. */
class MoveVirtualModifierFix extends DiagnosticQuickFix
{
    constructor() { super('moveVirtualModifier', true); }

    /** @description Revalidates the attached tag and supported method before changing documentation or syntax. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        const fields = [ 'declarationStart', 'memberStart', 'commentStart', 'commentEnd' ];
        const migration = LgdVirtualDocChecker.migrations(source.text, state.declarations)
            .find(candidate => fields.every(field => candidate[field] === fix[field]));
        if(!migration || fix.kind !== this.kind)
        {
            return null;
        }

        const original = source.text.slice(migration.commentStart, migration.commentEnd);
        const cleaned = this._removeTags(original, migration.tags);
        const gap = source.text.slice(migration.commentEnd, migration.memberStart);
        let offset = migration.commentStart;
        let newText = cleaned + gap;
        if(!this._hasContent(cleaned))
        {
            const lineStart = source.text.lastIndexOf('\n', offset - 1) + 1;
            const ownLine = (/^[\t ]*$/).test(source.text.slice(lineStart, offset));
            if(ownLine && gap.includes('\n'))
            {
                offset = lineStart;
                newText = gap.replace(/^[\t ]*\r?\n/, '');
            }
            else
            {
                newText = gap.includes('\n') ? gap : '';
            }
        }

        if(!migration.virtual)
        {
            newText += 'virtual ';
        }

        return { title: migration.virtual ? 'Remove redundant @virtual JSDoc tag' : 'Move @virtual to the method declaration',
            target: source, snapshots: snapshots, offset: offset, endOffset: migration.memberStart, newText: newText };
    }

    /** @description Removes only recognized tag tokens and otherwise-empty tag lines, preserving all prose and other tags. */
    _removeTags(comment, tags)
    {
        const lines = comment.split(/(?<=\n)/);
        let lineStart = 0;
        return lines.map((line, index) =>
        {
            const lineTags = tags.filter(tag => lineStart <= tag.offset && tag.offset < lineStart + line.length);
            let cleaned = line;
            for(const tag of lineTags.slice().reverse())
            {
                const start = tag.offset - lineStart;
                let end = tag.endOffset - lineStart;
                while(end < cleaned.length && (/[\t ]/).test(cleaned[end]))
                {
                    end++;
                }

                cleaned = cleaned.slice(0, start) + cleaned.slice(end);
            }

            lineStart += line.length;
            const emptyTagLine = lineTags.length > 0 && index > 0 && index < lines.length - 1 && (/^[\t ]*\*?[\t ]*\r?\n$/).test(cleaned);
            return emptyTagLine ? '' : cleaned;
        }).join('');
    }

    /** @description Treats descriptions and every remaining tag as meaningful documentation. */
    _hasContent(comment)
    {
        return comment.slice('/**'.length, -'*/'.length)
            .split(/\r?\n/)
            .some(line => line.replace(/^[\t ]*\*?[\t ]*/, '').trim().length > 0);
    }
}

module.exports = MoveVirtualModifierFix;
