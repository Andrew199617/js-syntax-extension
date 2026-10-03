const { maskCode } = require('./LgdInfer');
const LgdDocComment = require('./LgdDocComment');

/** @description A redundant documentation type is advisory and never blocks LGD emission. */
const message = 'Return type is already declared; the JSDoc type is not required.';

/**
 * @description Finds the exclusive end of a balanced JSDoc type expression.
 * @param {string} text the docblock text.
 * @param {number} start the opening brace offset.
 * @returns {number|null} the exclusive closing brace offset, or null when incomplete.
 */
function typeEnd(text, start)
{
    let depth = 0;
    let quote = null;
    for(let index = start; index < text.length; index++)
    {
        const character = text[index];
        if(quote)
        {
            if(character === '\\')
            {
                index++;
            }
            else if(character === quote)
            {
                quote = null;
            }
        }
        else if(character === '"' || character === "'")
        {
            quote = character;
        }
        else if(character === '{')
        {
            depth++;
        }
        else if(character === '}')
        {
            depth--;
            if(depth === 0)
            {
                return index + 1;
            }
        }
    }

    return null;
}

/** @description Separates redundant types from meaningful descriptions without matching fenced examples. */
function returnTags(comment)
{
    const tags = [];
    for(const line of LgdDocComment.lines(comment))
    {
        for(const tag of line.text.matchAll(/@returns?\b[\t ]*(?<open>{)/g))
        {
            const offset = line.offset + tag.index;
            if(tags.length > 0 && offset < tags.at(-1).endOffset)
            {
                continue;
            }

            const start = offset + tag[0].length - 1;
            const end = typeEnd(comment, start);
            if(end === null)
            {
                continue;
            }

            const trailing = comment.slice(end, -'*/'.length).split(/\s@[A-Za-z]/)[0];
            const description = trailing.split(/\r?\n/).map(text => text.replace(/^[\t ]*\*?[\t ]*/, '')).join('').trim();
            tags.push({ offset: offset, typeStart: start, endOffset: end, hasDescription: description.length > 0 });
        }
    }

    return tags;
}

/** @description Finds attached documentation on explicit return methods and named class constructors. */
function migrations(content, declarations)
{
    const members = declarations.flatMap(declaration =>
    {
        const methods = (declaration.methodTypedParams || [])
            .filter(group => group.returnTypeName)
            .map(group => ({ memberStart: declaration.initializerStart + group.methodStart, isConstructor: false }));
        if(declaration.kind === 'class' && declaration.constructorMember)
        {
            methods.push({ memberStart: declaration.constructorMember.start, isConstructor: true });
        }

        return methods.map(member => ({ ...member, declarationStart: declaration.headStart }));
    });

    if(members.length === 0)
    {
        return [];
    }

    const comments = [];
    maskCode(content, true, comments);
    const byEnd = new Map(comments.map(comment => [ comment.end, comment ]));
    const attached = [];
    for(const member of members)
    {
        let before = member.memberStart;
        while(before > 0 && (/\s/).test(content[before - 1]))
        {
            before--;
        }

        const comment = byEnd.get(before);
        if(!comment)
        {
            continue;
        }

        const tags = returnTags(content.slice(comment.start, comment.end));
        if(tags.length > 0)
        {
            attached.push({ ...member, commentStart: comment.start, commentEnd: comment.end, tags: tags });
        }
    }

    return attached;
}

/** @description Warns on redundant return types while preserving descriptive documentation and compilation. */
function check(content, declarations)
{
    return migrations(content, declarations).flatMap(migration =>
    {
        const quickFix = { kind: 'removeReturnDocType', declarationStart: migration.declarationStart,
            memberStart: migration.memberStart, commentStart: migration.commentStart, commentEnd: migration.commentEnd };
        const advisory = migration.isConstructor
            ? 'The constructor already creates this class; remove the redundant JSDoc return type.'
            : message;

        return migration.tags.map(tag => ({ code: 'lgd.jsdoc.returnType', severity: 'warning', message: advisory,
            offset: migration.commentStart + tag.typeStart, endOffset: migration.commentStart + tag.endOffset, quickFix: quickFix }));
    });
}

module.exports = { check: check, migrations: migrations };
