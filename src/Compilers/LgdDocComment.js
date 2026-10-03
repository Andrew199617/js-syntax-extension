/** @description Shares fence-aware source documentation scanning and conservative tag cleanup. */
const LgdDocComment = {
    /** @description Returns documentation lines outside fenced examples with their original offsets. */
    lines(comment)
    {
        const openingLength = '/**'.length;
        const body = comment.slice(openingLength, -'*/'.length);
        const lines = [];
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
            else if(!fence)
            {
                const offset = lineStart + prefix.length;
                lines.push({ offset: offset, text: text });
            }

            lineStart += line.length;
        }

        return lines;
    },

    /** @description Removes recognized tag ranges and drops the docblock only when it becomes empty. */
    edit(content, attachment, tags)
    {
        const original = content.slice(attachment.commentStart, attachment.commentEnd);
        const cleaned = this.removeTags(original, tags);
        const gap = content.slice(attachment.commentEnd, attachment.memberStart);
        let offset = attachment.commentStart;
        let newText = cleaned + gap;
        if(!this.hasContent(cleaned))
        {
            const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
            const ownLine = (/^[\t ]*$/).test(content.slice(lineStart, offset));
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

        return { offset: offset, endOffset: attachment.memberStart, newText: newText };
    },

    /** @description Removes only recognized tag tokens and otherwise-empty tag lines, preserving all prose and other tags. */
    removeTags(comment, tags)
    {
        let cleaned = comment;
        for(const tag of tags.slice().reverse())
        {
            let start = tag.offset;
            let end = tag.endOffset;
            while(end < cleaned.length && (/[\t ]/).test(cleaned[end]))
            {
                end++;
            }

            const lineStart = cleaned.lastIndexOf('\n', start - 1) + 1;
            const nextLine = cleaned.indexOf('\n', end);
            const prefix = cleaned.slice(lineStart, start);
            const suffix = cleaned.slice(end, nextLine);
            if(lineStart > 0 && nextLine !== -1 && (/^[\t ]*\*?[\t ]*$/).test(prefix) && (/^[\t ]*\r?$/).test(suffix))
            {
                start = lineStart;
                end = nextLine + 1;
            }

            cleaned = cleaned.slice(0, start) + cleaned.slice(end);
        }

        return cleaned;
    },

    /** @description Treats descriptions and every remaining tag as meaningful documentation. */
    hasContent(comment)
    {
        return comment.slice('/**'.length, -'*/'.length)
            .split(/\r?\n/)
            .some(line => line.replace(/^[\t ]*\*?[\t ]*/, '').trim().length > 0);
    }
};

module.exports = LgdDocComment;
