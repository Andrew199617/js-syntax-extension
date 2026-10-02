const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdClassSyntax = require('./LgdClassSyntax');
const LgdSourceMap = require('./LgdSourceMap');
const { parseMethodHead } = require('./LgdMethodSignature');
const { maskCode } = require('./LgdInfer');

/** @description Finds return-first heads without mistaking ordinary named JavaScript methods for annotations. */
const headPattern = /\b(?:async[\t ]+)?(?:void|(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*)[\t ]+[$A-Z_a-z][\w$]*\s*\(/g;

/** @description Rejects unsupported standalone return-first functions without extending the function grammar. */
const LgdStandaloneReturnChecker = {
    /** @description Checks whether source may contain an annotated function or method head. */
    hasCandidates(content)
    {
        headPattern.lastIndex = 0;
        return headPattern.test(maskCode(content, true));
    },

    /** @description Finds complete heads and bodies in a JavaScript mirror with supported LGD syntax already lowered. */
    candidates(code)
    {
        const masked = maskCode(code, true);
        const candidates = [];
        headPattern.lastIndex = 0;
        let match = headPattern.exec(masked);
        while(match)
        {
            const start = match.index;
            const head = parseMethodHead(masked.slice(start));
            const paramEnd = LgdClassSyntax.findClose(masked, start + head.paramStart);
            const bodyStart = LgdClassSyntax.skipSpace(masked, paramEnd + 1);
            const bodyEnd = masked[bodyStart] === '{' ? LgdClassSyntax.findClose(masked, bodyStart) : -1;

            // A line break permits an ordinary void call followed by a separate block.
            const ordinaryVoid = head.returnTypeName === 'void' && (/[\n\r]/).test(masked.slice(paramEnd + 1, bodyStart));
            if(paramEnd >= 0 && bodyEnd >= 0 && !ordinaryVoid)
            {
                candidates.push({ start: start, end: bodyEnd + 1, typeStart: start + head.returnTypeStart, nameEnd: start + head.nameEnd });
                headPattern.lastIndex = bodyEnd + 1;
            }

            match = headPattern.exec(masked);
        }

        return candidates;
    },

    /** @description Uses Babel statement ownership to distinguish standalone declarations from object properties and methods. */
    check(emitted)
    {
        const candidates = this.candidates(emitted.code);
        if(candidates.length === 0)
        {
            return [];
        }

        const masked = maskCode(emitted.code, true);
        const characters = emitted.code.split('');
        for(const candidate of candidates)
        {
            let start = candidate.start;
            const exported = (/\bexport\s+(?:default\s+)?$/).exec(masked.slice(0, start));
            if(exported)
            {
                start = exported.index;
            }

            // A one-character placeholder is both a valid statement expression and
            // an object shorthand property. Keep every offset and line ending intact.
            for(let index = start; index < candidate.end; index++)
            {
                if(characters[index] !== '\r' && characters[index] !== '\n')
                {
                    characters[index] = ' ';
                }
            }

            characters[candidate.start] = 'X';
        }

        let tree;
        try
        {
            tree = parser.parse(characters.join(''), { sourceType: 'unambiguous', errorRecovery: true, plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            return [];
        }

        const byStart = new Map(candidates.map(candidate => [ candidate.start, candidate ]));
        const map = LgdSourceMap.create(emitted.segments);
        const errors = [];
        traverse(tree, {
            /** @description Reports only placeholders that occupy standalone statement positions. */
            ExpressionStatement(path)
            {
                const expression = path.node.expression;
                const candidate = expression.type === 'Identifier' && byStart.get(expression.start);
                if(candidate)
                {
                    errors.push({
                        offset: map.toSource(candidate.typeStart),
                        endOffset: map.toSource(candidate.nameEnd),
                        message: 'Standalone return-first function declarations are not supported. Use a JavaScript function declaration with JSDoc, or a typed class/object method.'
                    });
                }
            }
        });
        return errors;
    }
};

module.exports = LgdStandaloneReturnChecker;
