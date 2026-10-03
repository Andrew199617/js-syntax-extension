const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdOverrideChecker = require('../../Compilers/LgdOverrideChecker');
const { splitTopLevelChunks, parseMethodHead } = require('../../Compilers/LgdTypedParams');
const { skipTrivia } = require('../../Compilers/LgdMethodSignature');

/** @description Plans explicit legacy-object contract preparation separately from the child conversion. */
const ObjectInheritanceContracts = {
    /** @description Adds required child overrides and previews any separately offered base-documentation edit. */
    plan(context, base, shape)
    {
        const plan = { externals: context.state.externals, overrides: [], preparation: null };
        if(!base.declaration)
        {
            return plan;
        }

        const described = LgdOverrideChecker.describeMethods(base.snapshot.text, [base.declaration], base.declaration);
        const inherited = new Map(described.methodSignatures.map(member => [ member.name, member ]));
        const pending = [];
        for(const member of shape.object.properties)
        {
            if(member === shape.factory)
            {
                continue;
            }

            const contract = inherited.get(member.key.name);
            if(!contract)
            {
                continue;
            }

            if(contract.kind !== 'method')
            {
                return null;
            }

            plan.overrides.push(contract.name);
            if(!contract.virtual)
            {
                pending.push(contract.name);
            }
        }

        if(pending.length === 0)
        {
            return plan;
        }

        // Companion edits retain the imported snapshot and are identified in each offered action title.
        if(base.snapshot === context.source || !base.entry)
        {
            return null;
        }

        const prepared = this._prepareBase(base, pending);
        if(!prepared)
        {
            return null;
        }

        const parsed = LgdCompiler.create().parse(prepared.text);
        const declaration = parsed.declarations.find(candidate => candidate.name === base.declaration.name);
        const methods = LgdOverrideChecker.describeMethods(prepared.text, parsed.allDeclarations, declaration);
        plan.externals = new Map(context.state.externals);
        for(const [ specifier, entry ] of plan.externals)
        {
            if(entry.sourcePath === base.entry.sourcePath)
            {
                plan.externals.set(specifier, { ...entry, sourceText: prepared.text, ...methods });
            }
        }

        const names = pending.map(name => `${shape.baseName}.${name}`).join(', ');
        plan.virtualTargets = names;
        plan.preparation = { title: `Make ${names} virtual to enable class conversion`,
            target: base.snapshot, offset: base.declaration.start, endOffset: base.declaration.end,
            newText: prepared.replacement };
        return plan;
    },

    /** @description Inserts virtual documentation only on verified own methods, retaining their existing descriptions and tags. */
    _prepareBase(base, names)
    {
        const { snapshot, declaration } = base;
        const compiler = LgdCompiler.create();
        const newline = compiler.detectNewline(snapshot.text);
        const edits = [];
        for(const chunk of splitTopLevelChunks(declaration.initializerText))
        {
            const head = parseMethodHead(chunk.text);
            if(!head || !names.includes(head.name))
            {
                continue;
            }

            const methodStart = declaration.initializerStart + chunk.start + skipTrivia(chunk.text, 0);
            const lineStart = snapshot.text.lastIndexOf('\n', methodStart - 1) + 1;
            const indent = (/^[\t ]*/).exec(snapshot.text.slice(lineStart, methodStart))[0];
            const docs = compiler.findPrecedingJsdoc(snapshot.text, methodStart);
            if(docs && docs.start >= declaration.initializerStart + chunk.start)
            {
                let comment;
                if(docs.text.includes('\n'))
                {
                    comment = docs.text.replace(/[\t ]*\*\/$/, `${indent} * @virtual${newline}${indent} */`);
                }
                else
                {
                    const body = docs.text.slice('/**'.length, -'*/'.length).trim();
                    comment = `/**${newline}${indent} * ${body}${newline}${indent} * @virtual${newline}${indent} */`;
                }

                edits.push({ start: docs.start, end: docs.start + docs.text.length, text: comment });
            }
            else
            {
                edits.push({ start: methodStart, end: methodStart, text: `/** @virtual */${newline}${indent}` });
            }
        }

        if(edits.length !== names.length)
        {
            return null;
        }

        let replacement = snapshot.text.slice(declaration.start, declaration.end);
        for(const edit of edits.sort((left, right) => right.start - left.start))
        {
            replacement = replacement.slice(0, edit.start - declaration.start) + edit.text + replacement.slice(edit.end - declaration.start);
        }

        const text = snapshot.text.slice(0, declaration.start) + replacement + snapshot.text.slice(declaration.end);
        return { replacement: replacement, text: text };
    }
};

module.exports = ObjectInheritanceContracts;
