/** @description Tracks source ranges for parser diagnostics. */
const ParserPosition = {
    /**
     * Update Position to a specific string.
     * @param {string} str the string that was parsed. The string we are exec on.
     * @param {string} string the string to update to.
     * @param {number} lastBegin The last begin line we were parsing.
     */
    updatePositionToString(content, string, lastBegin = 0)
    {
        const lines = content.split(/\r\n|\r|\n/);
        const stringLines = string.split(/\r\n|\r|\n/);
        const linesNoGroup = content.replace(string, '').split(/\r\n|\r|\n/);
        let localBeginLine = 0;
        let localEndLine = 0;

        for(let i = 0; i < lines.length; ++i)
        {
            if(lines[i] !== linesNoGroup[i])
            {
                this.beginCharacter = lines[i].replace(new RegExp(`${stringLines[0]}.*`, 's'), '').length;
                this.endCharacter = stringLines[stringLines.length - 1].length;
                this.beginLine = lastBegin + i;
                localBeginLine = i;
                break;
            }
        }

        if(linesNoGroup.length === lines.length)
        {
            this.endLine = this.beginLine;
            return;
        }

        if(linesNoGroup.length === localBeginLine + 1)
        {
            this.endLine = lastBegin + lines.length - 1;
            return;
        }

        let numMatched = 0;
        for(let i = localBeginLine; i < lines.length; ++i)
        {
            if(lines[i] !== linesNoGroup[localBeginLine + numMatched + 1])
            {
                numMatched = 0;
            }
            else if(numMatched < 2)
            {
                localEndLine = lastBegin + i;
                numMatched++;
            }
            else
            {
                this.endLine = lastBegin + i - numMatched;
                return;
            }
        }

        if(numMatched > 0)
        {
            this.endLine = localEndLine;
        }
    },

    /**
     * @description Update our position in the document to be able to log to the user where an error occurs.
     * @param {string} str the string that was parsed. The string we are exec on.
     * @param {RegExpExecArray} regExpExecArray the object that was produced from exec.
     * @param {string} group the group that we are updating to.
     * @param {number} lastBegin The last begin line we were parsing.
     */
    updatePosition(str, regExpExecArray, group, lastBegin = 0)
    {
        const lines = str.split(/\r\n|\r|\n/);
        const linesNoGroup = str.replace(regExpExecArray.groups[group], '').split(/\r\n|\r|\n/);
        let localBeginLine = 0;
        let localEndLine = 0;

        for(let i = 0; i < lines.length; ++i)
        {
            if(lines[i] !== linesNoGroup[i])
            {
                this.beginLine = lastBegin + i;
                localBeginLine = i;
                break;
            }
        }

        if(linesNoGroup.length === localBeginLine + 1)
        {
            this.endLine = lastBegin + lines.length - 1;
            return;
        }

        let numMatched = 0;
        for(let i = localBeginLine; i < lines.length; ++i)
        {
            if(lines[i] !== linesNoGroup[localBeginLine + numMatched + 1])
            {
                numMatched = 0;
            }
            else if(numMatched < 2)
            {
                localEndLine = lastBegin + i;
                numMatched++;
            }
            else
            {
                this.endLine = lastBegin + i - numMatched;
                return;
            }
        }

        if(numMatched > 0)
        {
            this.endLine = localEndLine;
        }
    }
};

module.exports = ParserPosition;
