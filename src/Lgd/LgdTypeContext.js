const LgdCompiler = require('../Compilers/LgdCompiler');
const LgdCastSyntax = require('../Compilers/LgdCastSyntax');
const { maskCode } = require('../Compilers/LgdInfer');

/** @description Finds supported LGD annotation positions using parser spans and recoverable declaration heads. */
const LgdTypeContext = {
    /** @description Reads the type token at the cursor, excluding comments, literals, bindings, and expressions. */
    find(text, offset, state = null, options = {})
    {
        const masked = maskCode(text, true);
        let start = offset;
        let end = offset;
        while(start > 0 && (/[\w$.]/).test(masked[start - 1]))
        {
            start--;
        }

        while(end < masked.length && (/[\w$.]/).test(masked[end]))
        {
            end++;
        }

        if(text.slice(start, offset) !== masked.slice(start, offset))
        {
            return null;
        }

        const token = text.slice(start, end);
        const prefix = text.slice(start, offset);
        const dot = prefix.lastIndexOf('.');
        const context = { start: start + dot + 1, end: end, prefix: prefix.slice(dot + 1),
            qualifier: dot === -1 ? '' : prefix.slice(0, dot), allowVoid: false, heritage: false };
        const current = state?.compiledText === text ? this._rangeAt(state.declarations, state.casts, offset) : null;
        if(current)
        {
            return { ...context, ...current };
        }

        const probe = `${text.slice(0, start)}Object${text.slice(end)}`;
        const compiler = LgdCompiler.create();
        const parsed = compiler.parse(probe, state?.externals || new Map(), { deferAnalysis: true });
        const found = this._rangeAt(parsed.allDeclarations, [], start);
        if(found)
        {
            return { ...context, ...found };
        }

        if(this._parameterSlot(parsed.allDeclarations, start, probe))
        {
            return context;
        }

        const parameterProbe = `${text.slice(0, start)}Object __lgdCompletionParameter${text.slice(end)}`;
        const recovered = compiler.parse(parameterProbe, state?.externals || new Map(), { deferAnalysis: true });
        if(this._rangeAt(recovered.allDeclarations, [], start))
        {
            return context;
        }

        const casts = LgdCastSyntax.candidates(probe, { content: probe, declarations: parsed.allDeclarations,
            externals: state?.externals || new Map(), map: { toSource: index => index } });
        if(casts.some(cast => cast.typeStart === start))
        {
            return context;
        }

        if(options.allowRecoveredHeads === false)
        {
            return null;
        }

        const before = masked.slice(0, start);
        const after = masked.slice(end);
        if((/\b(?:class|interface)\s+[$A-Z_a-z][\w$]*\s*:\s*(?:[$A-Z_a-z][\w$.]*\s*,\s*)*$/).test(before))
        {
            return { ...context, heritage: true };
        }

        // An unfinished declaration still has a type slot before its name exists.
        const head = (/(?:^|[\n\r;{}])[^\n\r;{}]*$/).exec(before)?.[0] || before;
        const modifiers = (/^[\n\r;{}]?\s*(?:(?:export|const|readonly|public|private|protected|internal|static|abstract|virtual|override|async)\s+)*$/).test(head);
        if(modifiers && !token.includes('.') && !(/^[\t ]*[(.:=[]/).test(after))
        {
            return { ...context, allowVoid: this._memberHead(state, start) };
        }

        return this._unfinishedParameter(before, after) ? context : null;
    },

    _rangeAt(declarations = [], casts = [], offset)
    {
        const ranges = casts.map(cast => ({ start: cast.typeStart, end: cast.typeEnd }));
        for(const declaration of declarations || [])
        {
            if(![ 'class', 'interface', 'enum' ].includes(declaration.kind))
            {
                ranges.push({ start: declaration.typeStart, end: declaration.typeEnd });
            }

            ranges.push(...(declaration.heritage || []).map(entry => ({ ...entry, heritage: true })));
            const groups = [ declaration.typedParams, ...declaration.methodTypedParams || [], ...declaration.classMembers || [] ];
            for(const group of groups.filter(Boolean))
            {
                const base = declaration.initializerStart;
                if(group.returnTypeName) ranges.push({ start: base + group.returnTypeStart, end: base + group.returnTypeEnd, allowVoid: true });
                if(group.propertyTypeName) ranges.push({ start: base + group.propertyTypeStart, end: base + group.propertyTypeEnd });
                ranges.push(...(group.params || []).filter(parameter => parameter.typeName)
                    .map(parameter => ({ start: base + parameter.typeStart, end: base + parameter.typeEnd })));
            }
        }

        const found = ranges.find(range => range.start <= offset && offset <= range.end);
        return found ? { allowVoid: Boolean(found.allowVoid), heritage: Boolean(found.heritage) } : null;
    },

    _parameterSlot(declarations, offset, text)
    {
        for(const declaration of declarations)
        {
            const groups = [ declaration.typedParams, ...declaration.methodTypedParams || [] ].filter(Boolean);
            for(const group of groups)
            {
                const start = declaration.initializerStart + group.start;
                const end = declaration.initializerStart + group.end;
                if(start < offset && offset < end)
                {
                    const before = text.slice(start + 1, offset).split(',').pop();
                    if((/^\s*(?:\.{3})?\s*$/).test(before))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    },

    _memberHead(state, offset)
    {
        return (state?.declarations || []).some(declaration =>
        {
            const kind = [ 'class', 'interface' ].includes(declaration.kind);
            const body = declaration.initializerStart < offset && offset < declaration.initializerEnd;
            const memberBody = (declaration.classMembers || []).some(member => member.bodyStart < offset && offset < member.bodyEnd);
            return kind && body && !memberBody;
        });
    },

    _unfinishedParameter(before, after)
    {
        const open = before.lastIndexOf('(');
        if(open === -1)
        {
            return false;
        }

        const chunk = before.slice(open + 1);
        if(!(/^(?:\s*(?:[$A-Z_a-z][\w$.?]*\s+)?[$A-Z_a-z][\w$]*\s*,)*\s*(?:\.{3})?\s*$/).test(chunk))
        {
            return false;
        }

        const head = before.slice(0, open).trimEnd();
        const functionHead = (/\bfunction(?:\s+[$A-Z_a-z][\w$]*)?$/).test(head);
        const arrowHead = (/=\s*(?:async\s*)?$/).test(head) && (/^\s*\)[\t ]*=>/).test(after);
        return functionHead || arrowHead;
    }
};

module.exports = LgdTypeContext;
