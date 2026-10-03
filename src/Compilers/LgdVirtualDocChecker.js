const { maskCode } = require('./LgdInfer');

/** @description Advises class methods to express virtual behavior in their LGD declaration. */
const LgdVirtualDocChecker = {
    /** @description Finds attached legacy tags only where an inline virtual modifier is valid. */
    migrations(content, declarations)
    {
        const comments = [];
        maskCode(content, true, comments);
        const byEnd = new Map(comments.map(comment => [ comment.end, comment ]));
        const migrations = [];
        for(const declaration of declarations)
        {
            if(declaration.kind !== 'class')
            {
                continue;
            }

            for(const member of declaration.classMembers || [])
            {
                if(!this._eligible(member))
                {
                    continue;
                }

                let before = member.start;
                while(before > 0 && (/\s/).test(content[before - 1]))
                {
                    before--;
                }

                const comment = byEnd.get(before);
                if(!comment || comment.start <= declaration.initializerStart)
                {
                    continue;
                }

                const tags = this.tags(content.slice(comment.start, comment.end));
                if(tags.length > 0)
                {
                    migrations.push({ declarationStart: declaration.headStart, memberStart: member.start,
                        commentStart: comment.start, commentEnd: comment.end, virtual: member.virtual, tags: tags });
                }
            }
        }

        return migrations;
    },

    /** @description Keeps constructors, static members, accessors and contract modifiers out of migration fixes. */
    _eligible(member)
    {
        const unsupported = member.isConstructor || member.static || member.accessor || member.abstract || member.override;
        return member.kind === 'method' && !unsupported && ![ 'constructor', 'create' ].includes(member.name);
    },

    /** @description Recognizes directive lines without treating prose mentions or longer tag names as virtual tags. */
    tags(comment)
    {
        const openingLength = '/**'.length;
        const body = comment.slice(openingLength, -'*/'.length);
        const tags = [];
        let lineStart = openingLength;
        let fence = null;
        for(const line of body.split(/(?<=\n)/))
        {
            const prefix = (/^[\t ]*\*?[\t ]*/).exec(line)[0];
            const text = line.slice(prefix.length);
            const marker = (/^(?<marker>`{3,}|~{3,})/).exec(text)?.groups.marker;
            if(marker)
            {
                if(!fence)
                {
                    fence = marker;
                }
                else if(marker[0] === fence[0] && marker.length >= fence.length && text.slice(marker.length).trim() === '')
                {
                    fence = null;
                }
            }
            else if(!fence && (/^@virtual(?=\s|$)/).test(text))
            {
                const offset = lineStart + prefix.length;
                tags.push({ offset: offset, endOffset: offset + '@virtual'.length });
            }

            lineStart += line.length;
        }

        return tags;
    },

    /** @description Matches the nonblocking severity of redundant return-type documentation. */
    check(content, declarations)
    {
        return this.migrations(content, declarations).flatMap(migration =>
        {
            const message = migration.virtual
                ? 'Virtual is already declared; remove the @virtual JSDoc tag.'
                : 'Declare virtual inline on the LGD method instead of using the @virtual JSDoc tag.';
            const quickFix = { kind: 'moveVirtualModifier', declarationStart: migration.declarationStart,
                memberStart: migration.memberStart, commentStart: migration.commentStart, commentEnd: migration.commentEnd };

            return migration.tags.map(tag => ({ code: 'lgd.jsdoc.virtual', severity: 'warning', message: message,
                offset: migration.commentStart + tag.offset, endOffset: migration.commentStart + tag.endOffset, quickFix: quickFix }));
        });
    }
};

module.exports = LgdVirtualDocChecker;
