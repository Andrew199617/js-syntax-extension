const espree = require('espree');
const typescript = require('typescript-test-5-9');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdOverrideChecker = require('../../../src/Compilers/LgdOverrideChecker');
const LgdClassMemberSemantics = require('../../../src/Compilers/LgdClassMemberSemantics');

/** @description Reads the attached JSDoc of an emitted method in either supported JavaScript object model. */
function methodDocumentation(source, ownerName, methodName = 'run')
{
    const tree = espree.parse(source, { ecmaVersion: 'latest', comment: true, range: true });
    const owner = tree.body.find(statement => statement.id?.name === ownerName || statement.declarations?.[0]?.id.name === ownerName);
    const members = owner.type === 'ClassDeclaration' ? owner.body.body : owner.declarations[0].init.properties;
    const member = members.find(candidate => candidate.key?.name === methodName);
    const comments = tree.comments.filter(comment =>
    {
        const isDocumentation = comment.type === 'Block' && comment.value.startsWith('*');
        const precedesMember = comment.range[0] >= owner.range[0] && comment.range[1] <= member.range[0];
        return isDocumentation && precedesMember;
    });

    const nearest = comments[comments.length - 1];
    if(!nearest || source.slice(nearest.range[1], member.range[0]).trim())
    {
        return '';
    }

    return source.slice(nearest.range[0], nearest.range[1]);
}

/** @description Exports and serializes the real compiler method metadata used across CommonJS file boundaries. */
function exportedMethods(source, name, externals = new Map())
{
    const parsed = LgdCompiler.create().parse(source, externals);
    const declaration = parsed.allDeclarations.find(candidate => candidate.name === name);
    const methods = LgdOverrideChecker.describeMethods(source, parsed.allDeclarations, declaration, externals);
    const members = LgdClassMemberSemantics.describeMembers(source, parsed.allDeclarations, declaration, externals);
    return JSON.parse(JSON.stringify({ exportName: name, keyword: 'Object', kind: 'class', ...methods, members: members }));
}

/** @description Opens the emitted mirror in a real TypeScript service without loading unrelated standard libraries. */
function createTypeService(code)
{
    const filename = '/lgd-inherited-documentation.js';
    const options = { allowJs: true, checkJs: true, noLib: true, types: [], target: typescript.ScriptTarget.ES2020 };
    const host = {
        getScriptFileNames: () => [filename],
        getScriptVersion: () => '0',

        /** @description Provides the single in-memory mirror snapshot. */
        getScriptSnapshot: name =>
        {
            if(name === filename)
            {
                return typescript.ScriptSnapshot.fromString(code);
            }
        },
        getCurrentDirectory: () => '/',
        getCompilationSettings: () => options,
        getDefaultLibFileName: () => '',
        fileExists: name => name === filename,

        /** @description Reads the single in-memory mirror source. */
        readFile: name =>
        {
            if(name === filename)
            {
                return code;
            }
        }
    };

    return { service: typescript.createLanguageService(host), filename: filename };
}

/** @description Base method documentation deliberately omits redundant LGD parameter and return types. */
const documentedBase = [
    'class Base {',
    '    /**',
    '     * @description Runs the requested command.',
    '     * @param count The number of repetitions.',
    '     * @returns The completed count.',
    '     */',
    '    virtual Number run(Number count) { return count; }',
    '}'
].join('\n');

describe.each([ 'oloo', 'class' ])('Override documentation in %s JavaScript output', objectModel =>
{
    test.each([ 'constructor', 'toString', '__proto__' ])('keeps parameter prose safe when renaming %s', specialName =>
    {
        for(const [ baseName, childName ] of [ [ specialName, 'renamed' ], [ 'original', specialName ] ])
        {
            for(const prose of [ '', 'Authored parameter prose.' ])
            {
                const comment = prose ? `/** @param ${baseName} ${prose} */` : '';
                const source = [
                    `class Base { ${comment} virtual Number run(Number ${baseName}) { return ${baseName}; } }`,
                    `class Child : Base { /** @inheritdoc */ override Number run(Number ${childName}) { return ${childName}; } }`
                ].join('\n');
                const exported = exportedMethods(source, 'Base');
                const serialized = JSON.parse(JSON.stringify(exported));
                const child = `const Base = require("./Base.js");\nclass Child : Base { /** @inheritdoc */ override Number run(Number ${childName}) { return ${childName}; } }`;
                const imports = new Map([[ './Base.js', serialized ]]);
                const result = LgdCompiler.create().compileToJs(child, imports, { javascriptObjectModel: objectModel });
                const documentation = methodDocumentation(result.code, 'Child');
                expect(result.errors).toEqual([]);
                expect(documentation).toContain(`@param {number} ${childName}${prose ? ` ${prose}` : ''}`);
                expect(documentation.includes('Authored parameter prose.')).toBe(Boolean(prose));
                expect(documentation).not.toMatch(/native code|function Object|object Object/);
            }
        }
    });

    test('explicit inheritance from an undocumented base does not leak conflicting child prose', () =>
    {
        const source = [
            'class Base { virtual Number run(Number count) { return count; } }',
            'class Child : Base {',
            '    /**',
            '     * Child prose is ignored.',
            '     * @inheritdoc',
            '     * @param total Ignored parameter prose.',
            '     */',
            '    override Number run(Number total) { return total; }',
            '}'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const documentation = methodDocumentation(result.code, 'Child');
        expect(result.errors).toEqual([]);
        expect(documentation).not.toContain('Child prose');
        expect(documentation).not.toContain('Ignored parameter');
        expect(documentation).not.toContain('@inheritdoc');
        expect(documentation).toContain('@param {number} total');
    });

    test.each([ '', '/** */' ])('inherits concrete base prose for the empty child documentation %s', comment =>
    {
        const source = `${documentedBase}\nclass Child : Base { ${comment} override Number run(Number total) { return total; } }`;
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const documentation = methodDocumentation(result.code, 'Child');

        expect(result.errors).toEqual([]);
        expect(documentation).toContain('Runs the requested command.');
        expect(documentation).toContain('@param {number} total The number of repetitions.');
        expect(documentation).toContain('@returns {number} The completed count.');
        expect(documentation).not.toContain('@param {number} count');
        expect(documentation.match(/@param\b/g)).toHaveLength(1);
        expect(documentation.match(/@returns\b/g)).toHaveLength(1);
    });

    test('shows inherited prose in real TypeScript quick info and renamed-parameter signature help', () =>
    {
        const source = [
            documentedBase,
            'class Child : Base { override Number run(Number total) { return total; } }',
            'Child command = Child.create();',
            'command.run(1);'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const { service, filename } = createTypeService(result.code);
        try
        {
            expect(result.errors).toEqual([]);
            const offset = result.code.lastIndexOf('command.run') + 'command.'.length;
            const info = service.getQuickInfoAtPosition(filename, offset);
            expect(typescript.displayPartsToString(info.displayParts)).toContain('run(total: number): number');
            expect(typescript.displayPartsToString(info.documentation)).toBe('Runs the requested command.');
            expect(typescript.displayPartsToString(info.tags.find(tag => tag.name === 'param').text)).toBe('total The number of repetitions.');
            expect(typescript.displayPartsToString(info.tags.find(tag => tag.name === 'returns').text)).toBe('The completed count.');

            const help = service.getSignatureHelpItems(filename, offset + 'run('.length);
            const signature = help.items[help.selectedItemIndex];
            expect(typescript.displayPartsToString(signature.documentation)).toBe('Runs the requested command.');
            expect(signature.parameters[0].name).toBe('total');
            expect(typescript.displayPartsToString(signature.parameters[0].documentation)).toBe('The number of repetitions.');
            expect(typescript.displayPartsToString(signature.tags.find(tag => tag.name === 'returns').text)).toBe('The completed count.');
            expect(service.getSyntacticDiagnostics(filename)).toEqual([]);
        }
        finally
        {
            service.dispose();
        }
    });

    test('inherits the nearest whole docblock transitively without filling missing own prose from ancestors', () =>
    {
        const source = [
            documentedBase,
            'class Middle : Base {',
            '    /** @description Runs the middle command. */',
            '    override Number run(Number amount) { return amount; }',
            '}',
            'class Leaf : Middle { override Number run(Number total) { return total; } }'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const middle = methodDocumentation(result.code, 'Middle');
        const leaf = methodDocumentation(result.code, 'Leaf');

        expect(result.errors).toEqual([]);
        for(const documentation of [ middle, leaf ])
        {
            expect(documentation).toContain('Runs the middle command.');
            expect(documentation).not.toContain('Runs the requested command.');
            expect(documentation).not.toContain('The number of repetitions.');
            expect(documentation).not.toContain('The completed count.');
        }

        expect(middle).toContain('@param {number} amount');
        expect(leaf).toContain('@param {number} total');
    });

    test.each([ 'inheritdoc', 'inheritDoc' ])('uses the base documentation exclusively when @%s is explicit', directive =>
    {
        const source = [
            documentedBase,
            'class Child : Base {',
            '    /**',
            '     * @description Runs the child command.',
            '     * @param total The child repetitions.',
            '     * @returns The child result.',
            '     * @deprecated Child-only deprecation.',
            `     * @${directive}`,
            '     */',
            '    override Number run(Number total) { return total; }',
            '}'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const documentation = methodDocumentation(result.code, 'Child');

        expect(result.errors).toEqual([]);
        expect(documentation).toContain('Runs the requested command.');
        expect(documentation).toContain('@param {number} total The number of repetitions.');
        expect(documentation).toContain('@returns {number} The completed count.');
        expect(documentation).not.toContain('Runs the child command.');
        expect(documentation).not.toContain('The child repetitions.');
        expect(documentation).not.toContain('The child result.');
        expect(documentation).not.toContain('@deprecated');
        expect(documentation).not.toMatch(/@inherit[Dd]oc\b/);
    });

    test('does not copy base control tags onto the overriding method', () =>
    {
        const source = `${documentedBase.replace('     * @param count', '     * @virtual\n     * @param count')}\nclass Child : Base { override Number run(Number total) { return total; } }`;
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        const documentation = methodDocumentation(result.code, 'Child');

        expect(result.errors.filter(error => error.severity !== 'warning')).toEqual([]);
        expect(documentation).toContain('Runs the requested command.');
        expect(documentation).toContain('@param {number} total The number of repetitions.');
        expect(documentation).not.toMatch(/@(?:virtual|abstract|override)\b/);
    });

    test('retains effective documentation through serialized metadata from two imported files', () =>
    {
        const base = exportedMethods(documentedBase, 'Base');
        const middleImports = new Map([[ './Base.js', base ]]);
        const middleSource = [
            'const Parent = require("./Base.js");',
            'class Middle : Parent {',
            '    override Number run(Number amount) { return amount; }',
            '}'
        ].join('\n');
        const middle = exportedMethods(middleSource, 'Middle', middleImports);
        const leafImports = new Map([[ './Middle.js', middle ]]);
        const leafSource = 'const Parent = require("./Middle.js");\nclass Leaf : Parent { override Number run(Number total) { return total; } }';
        const result = LgdCompiler.create().compileToJs(leafSource, leafImports, { javascriptObjectModel: objectModel });
        const documentation = methodDocumentation(result.code, 'Leaf');

        expect(result.errors).toEqual([]);
        expect(middle).toMatchObject({ methodsKnown: true, methodSignatures: [{ name: 'run', declaredIn: 'Middle', params: [{ name: 'amount' }] }] });
        expect(middle.members.find(member => member.name === 'run').documentation).toMatchObject({
            description: 'Runs the requested command.',
            params: { amount: 'The number of repetitions.' },
            returns: 'The completed count.'
        });
        expect(documentation).toContain('Runs the requested command.');
        expect(documentation).toContain('@param {number} total The number of repetitions.');
        expect(documentation).toContain('@returns {number} The completed count.');
        expect(documentation).not.toContain('@param {number} amount');
    });
});

describe('Conservative override documentation metadata', () =>
{
    test.each([ '', '/** */', '/** @inheritdoc */' ])('does not invent prose for an undocumented base and child comment %s', comment =>
    {
        const source = `class Base { virtual Number run(Number count) { return count; } }\nclass Child : Base { ${comment} override Number run(Number total) { return total; } }`;
        const result = LgdCompiler.create().compileToJs(source);
        const documentation = methodDocumentation(result.code, 'Child');

        expect(result.errors).toEqual([]);
        expect(documentation).toContain('@param {number} total');
        expect(documentation).toContain('@returns {number}');
        expect(documentation).not.toContain('@description');
        expect(documentation).not.toMatch(/\b(?:undefined|null)\b/);
    });

    test('terminates a circular ancestry without borrowing unrelated method documentation', () =>
    {
        const source = [
            'class First : Second { /** @inheritdoc */ override Number run(Number count) { return count; } }',
            'class Second : First { /** @description Unrelated method. */ virtual void stop() {} }'
        ].join('\n');
        const first = exportedMethods(source, 'First');
        const result = LgdCompiler.create().compileToJs(source);
        const documentation = methodDocumentation(result.code, 'First');

        expect(first.methodsKnown).toBe(false);
        expect(first.methodSignatures.some(member => member.name === 'run')).toBe(true);
        expect(documentation).not.toContain('Unrelated method.');
        expect(documentation).not.toMatch(/\b(?:undefined|null)\b/);
    });
});
