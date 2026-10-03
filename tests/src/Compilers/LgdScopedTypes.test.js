const virtualMachine = require('vm');
const traverse = require('@babel/traverse').default;
const LgdAssignmentChecker = require('../../../src/Compilers/LgdAssignmentChecker');
const LgdReturnChecker = require('../../../src/Compilers/LgdReturnChecker');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

function compileErrors(source, objectModel = 'oloo')
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel }).errors;
}

function expectSourceDiagnostic(source, contract, objectModel = 'oloo')
{
    const markerOffset = source.indexOf(contract.marker);
    expect(markerOffset).toBeGreaterThanOrEqual(0);
    const offset = markerOffset + (contract.shift || 0);
    const expected = {
        message: contract.message,
        offset: offset,
        line: source.slice(0, offset).split(/\r?\n/).length
    };
    if(contract.length > 0)
    {
        expected.endOffset = offset + contract.length;
    }

    const errors = compileErrors(source, objectModel);
    expect(errors).toContainEqual(expect.objectContaining(expected));
    return errors;
}

function methodSource(body, owner, signature = 'Number read(Boolean ready)')
{
    const method = `${signature} {\n${body}\n}`;
    return owner === 'class' ? `class Counter {\n${method}\n}` : `Object Counter = {\n${method}\n};`;
}

describe.each([ '\n', '\r\n' ])('LGD scoped assignment diagnostics with %j line endings.', newline =>
{
    test.each([
        [ 'top-level typed arrow parameters', [ 'Function run = (Number value) => {', '    value = "wrong";', '};' ] ],
        [ 'top-level typed function-expression parameters', [ 'Function run = function(Number value) {', '    value = "wrong";', '};' ] ],
        [ 'top-level function locals', [ 'Function run = () => {', '    Number value = 1;', '    value = "wrong";', '};' ] ],
        [ 'object method parameters', [ 'Object Counter = {', '    run(Number value) {', '        value = "wrong";', '    }', '};' ] ],
        [ 'object method locals', [ 'Object Counter = {', '    run() {', '        Number value = 1;', '        value = "wrong";', '    }', '};' ] ],
        [ 'nested typed parameters', [ 'Function run = (Number value) => {', '    Function nested = (String value) => {', '        value = 1;', '    };', '};' ], '1;', 'Cannot assign Number to String.' ],
        [ 'captured parameters in ordinary callbacks', [ 'Function run = (Number value) => {', '    const callback = () => { value = "wrong"; };', '};' ] ],
        [ 'captured locals in nested declarations', [ 'Function run = () => {', '    Number value = 1;', '    function callback() { value = "wrong"; }', '};' ] ]
    ])('Rejects incompatible writes to %s.', (label, lines, marker = '"wrong"', message = 'Cannot assign String to Number.') =>
    {
        const source = lines.join(newline);
        expectSourceDiagnostic(source, { message: message, marker: marker });
    });

    test.each([ 'oloo', 'class' ])('Checks class parameters, locals, and constructors in the %s model.', objectModel =>
    {
        const bodies = [
            [ 'Number read(Number value) {', '    value = "wrong";', '    return value;', '}' ],
            [ 'read() {', '    Number value = 1;', '    value = "wrong";', '}' ],
            [ 'Counter(Number value) {', '    value = "wrong";', '}' ]
        ];
        for(const body of bodies)
        {
            const source = [ 'class Counter {', ...body, '}' ].join(newline);
            expectSourceDiagnostic(source, { message: 'Cannot assign String to Number.', marker: '"wrong"' }, objectModel);
        }
    });

    test.each([
        [ 'arrow', ['Function run = (Number value = "wrong") => {};'] ],
        [ 'object method', [ 'Object Counter = {', '    run(Number value = "wrong") {}', '};' ] ],
        [ 'class method', [ 'class Counter {', '    run(Number value = "wrong") {}', '}' ] ],
        [ 'constructor', [ 'class Counter {', '    Counter(Number value = "wrong") {}', '}' ] ]
    ])('Validates typed defaults on a %s.', (label, lines) =>
    {
        const source = lines.join(newline);
        expectSourceDiagnostic(source, { message: 'Cannot assign String to Number.', marker: '"wrong"' });
    });

    test('Reports the declaration initializer in the innermost typed parameter scope.', () =>
    {
        const source = [
            'Number value = 1;',
            'Function run = (String value) => {',
            '    Number invalid = value;',
            '};'
        ].join(newline);
        expectSourceDiagnostic(source, { message: 'Cannot assign String to Number.', marker: 'value;' });
    });
});

describe('LGD assignment operators and patterns.', () =>
{
    test.each([
        [ 'addition', 'value += "wrong";', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'logical or', 'value ||= "wrong";', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'logical and', 'value &&= "wrong";', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'nullish assignment', 'value ??= "wrong";', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'array destructuring', '[value] = ["wrong"];', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'object destructuring', '({ value } = { value: "wrong" });', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'renamed object destructuring', '({ label: value } = { label: "wrong" });', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'array pattern defaults', '[value = "wrong"] = [];', '"wrong"', 'Cannot assign String to Number.' ],
        [ 'object pattern defaults', '({ value = "wrong" } = {});', '"wrong"', 'Cannot assign String to Number.' ]
    ])('Checks %s against the typed target.', (label, statement, marker, message) =>
    {
        const source = `Function run = (Number value) => {\n    ${statement}\n};`;
        expectSourceDiagnostic(source, { message: message, marker: marker });
    });

    test('Checks the result of multiplication rather than just the right operand.', () =>
    {
        const source = 'Function run = (String value) => {\n    value *= "2";\n};';
        expectSourceDiagnostic(source, { message: 'Cannot assign Number to String.', marker: '"2"' });
    });

    test.each([ 'value += 1;', 'value++;', '[value] = [2];', '({ value } = { value: 2 });' ])('Keeps readonly bindings protected through %s.', statement =>
    {
        const source = `readonly Number value = 1;\n${statement}`;
        const errors = compileErrors(source);
        const assignmentOffset = source.indexOf(statement, source.indexOf('\n')) + statement.indexOf('value');
        expect(errors).toContainEqual(expect.objectContaining({ message: "Cannot assign to readonly variable 'value'.", offset: assignmentOffset }));
    });

    test('Treats a rest parameter binding as an Array rather than its element type.', () =>
    {
        const source = 'Function run = (...Number values) => {\n    values = "wrong";\n};';
        expectSourceDiagnostic(source, { message: 'Cannot assign String to Array.', marker: '"wrong"' });
    });

    test.each([
        'Function run = (Number value) => {\n    ({ value } = { value: "bad", value: 2 });\n};',
        'Function run = (Number value) => {\n    ({ value } = { value: "bad", ...{ value: 2 } });\n};',
        'Function run = (Number value) => {\n    ({ value } = { value: "bad", ...externalRecord });\n};',
        'Function run = (Number value) => {\n    [value = "bad"] = [2];\n};',
        'Function run = (Number value) => {\n    ({ value = "bad" } = { value: 2 });\n};',
        'Function run = (...Number values) => {\n    values = [1, 2];\n    Array copied = values;\n};',
        'Function run = (Number value) => {\n    [value] = [2];\n    ({ value } = { value: 3 });\n    value += 1;\n};',
        'Function run = (Number value) => {\n    [value] = externalValues();\n    ({ value } = externalRecord());\n};',
        'Function run = (Number value) => {\n    ({ value: other } = { value: "text" });\n    value = 2;\n};'
    ])('Accepts compatible or unknowable pattern and rest assignments: %s.', source =>
    {
        expect(compileErrors(source)).toEqual([]);
    });
});

describe('LGD lexical shadowing and unknown values.', () =>
{
    test.each([
        [ 'ordinary arrow parameters', 'Function run = (Number value) => {\n    const callback = value => { value = "allowed"; };\n    value = 2;\n};' ],
        [ 'ordinary function parameters', 'Function run = (Number value) => {\n    function callback(value) { value = "allowed"; }\n    value = 2;\n};' ],
        [ 'destructured callback parameters', 'Function run = (Number value) => {\n    const callback = ({ value }) => { value = "allowed"; };\n    value = 2;\n};' ],
        [ 'catch parameters', 'Number value = 1;\ntry {} catch(value) { value = "allowed"; }\nvalue = 2;' ],
        [ 'ordinary block locals', 'Function run = (Number value) => {\n    { let value = "text"; value = "allowed"; }\n    value = 2;\n};' ],
        [ 'loop locals', 'Number value = 1;\nfor(let value of ["text"]) { value = "allowed"; }\nvalue = 2;' ],
        [ 'sibling methods', 'Object Counter = {\n    first(Number value) { value = 2; },\n    second(String value) { value = "allowed"; }\n};' ],
        [ 'unknown calls and member values', 'Function run = (Number value) => {\n    value = external();\n    value = externalRecord.amount;\n};' ],
        [ 'unknown default expressions', 'class Counter {\n    Counter(Number value = external()) {}\n    read(Number value = externalRecord.amount) {}\n}' ]
    ])('Does not leak contracts into %s.', (label, source) =>
    {
        expect(compileErrors(source)).toEqual([]);
    });

    test('Restores the outer contract when a callback parameter scope closes.', () =>
    {
        const source = [
            'Function run = (Number value) => {',
            '    const callback = value => { value = "allowed"; };',
            '    value = "wrong";',
            '};'
        ].join('\n');
        const errors = expectSourceDiagnostic(source, { message: 'Cannot assign String to Number.', marker: '"wrong"' });
        expect(errors).toHaveLength(1);
    });

    test('Uses the typed local shadow instead of an outer parameter contract.', () =>
    {
        const source = [
            'Function run = (Number value) => {',
            '    {',
            '        String value = "text";',
            '        value = 1;',
            '    }',
            '    value = 2;',
            '};'
        ].join('\n');
        expectSourceDiagnostic(source, { message: 'Cannot assign Number to String.', marker: '1;' });
    });

    test('Keeps method-local names out of later sibling initializers.', () =>
    {
        const source = [
            'Object Counter = {',
            '    first() {',
            '        String value = "text";',
            '    },',
            '    second(Number value) {',
            '        Number copied = value;',
            '        copied = 2;',
            '    }',
            '};'
        ].join('\n');
        expect(compileErrors(source)).toEqual([]);
    });
});

describe('LGD nominal binding identities.', () =>
{
    test.each([
        [ 'scalar type identities', 'Number Count = 1;\nCount value = Count;' ],
        [ 'object aliases', 'Object Item = {};\nconst alias = Item;\nItem value = alias;' ],
        [ 'conditional scalar identities', 'Boolean ready = external();\nNumber Count = 1;\nCount value = ready ? Count : Count;' ],
        [ 'typed alias chains', 'Number Count = 1;\nCount first = Count;\nCount second = first;' ],
        [ 'ordinary constant alias chains', 'Number Count = 1;\nconst first = Count;\nconst second = first;\nCount value = second;' ]
    ])('Retains %s without widening to the underlying primitive or Object.', (label, source) =>
    {
        expect(compileErrors(source)).toEqual([]);
    });

    test('Keeps unrelated scalar identities incompatible.', () =>
    {
        const source = 'Number Count = 1;\nNumber Other = 2;\nCount value = Other;';
        expectSourceDiagnostic(source, { message: 'Cannot assign Other to Count.', marker: 'Other;', length: 'Other'.length });
    });
});

describe.each([ 'object', 'class' ])('LGD scoped return values in %s methods.', owner =>
{
    test.each([
        [ 'mutable locals reassigned to strings', 'let value = 1;\nvalue = "wrong";\nreturn value;', 'value', 'String' ],
        [ 'conditional assignments', 'let value = 1;\nif(ready) value = "wrong";\nreturn value;', 'value', 'String' ],
        [ 'while-loop assignments', 'let value = 1;\nwhile(ready) { value = "wrong"; break; }\nreturn value;', 'value', 'String' ],
        [ 'do-loop assignments', 'let value = 1;\ndo { value = "wrong"; } while(false);\nreturn value;', 'value', 'String' ],
        [ 'for-loop assignments', 'let value = 1;\nfor(;ready;) { value = "wrong"; break; }\nreturn value;', 'value', 'String' ],
        [ 'null local initializers', 'Number value = null;\nreturn value;', 'value', 'null' ],
        [ 'null local reassignments', 'Number value = 1;\nvalue = null;\nreturn value;', 'value', 'null' ],
        [ 'undefined local reassignments', 'Number value = 1;\nvalue = undefined;\nreturn value;', 'value', 'undefined' ],
        [ 'logical and assignments', 'let value = 1;\nvalue &&= "wrong";\nreturn value;', 'value', 'String' ],
        [ 'logical or assignments', 'let value = 0;\nvalue ||= "wrong";\nreturn value;', 'value', 'String' ],
        [ 'nullish assignments', 'let value = null;\nvalue ??= "wrong";\nreturn value;', 'value', 'String' ],
        [ 'compound local assignments', 'let value = 1;\nvalue += "wrong";\nreturn value;', 'value', 'String' ],
        [ 'destructured local assignments', 'let value = 1;\n[value] = ["wrong"];\nreturn value;', 'value', 'String' ],
        [ 'async local reassignments', 'let value = 1;\nvalue = "wrong";\nreturn await Promise.resolve(value);', 'await Promise.resolve(value)', 'String' ]
    ])('Rejects known incompatible %s at the returned expression.', (label, body, expression, inferred) =>
    {
        let signature = 'Number read(Boolean ready)';
        if(expression.startsWith('await '))
        {
            signature = 'async Number read()';
        }

        const source = methodSource(body, owner, signature);
        expectSourceDiagnostic(source, {
            message: `Cannot return ${inferred} from a Number method.`,
            marker: `return ${expression};`,
            shift: 'return '.length,
            length: expression.length
        });
    });

    test('Keeps parameter assignments checked before a declared return can hide them.', () =>
    {
        const source = methodSource('value = "wrong";\nreturn value;', owner, 'Number read(Number value)');
        const errors = expectSourceDiagnostic(source, { message: 'Cannot assign String to Number.', marker: '"wrong"' });
        expect(errors).toHaveLength(1);
    });

    test.each([
        [ 'typed initializers', 'Number result = "wrong";\nreturn result;' ],
        [ 'joined branches', 'if(ready) value = "wrong"; else value = 2;\nreturn value;' ],
        [ 'loop writes', 'while(ready) { value = "wrong"; break; }\nreturn value;' ],
        [ 'compound writes', 'value += "wrong";\nreturn value;' ],
        [ 'logical writes', 'value &&= "wrong";\nreturn value;' ],
        [ 'destructured writes', '[value] = ["wrong"];\nreturn value;' ],
        [ 'restored Number values', 'value = "wrong";\nvalue = 2;\nreturn value;' ],
        [ 'later compatible compound writes', 'value += "wrong";\nvalue += 1;\nreturn value;' ],
        [ 'typed downstream initializers', 'value = "wrong";\nNumber copied = value;\nreturn copied;' ]
    ])('Recovers %s only after retaining the diagnosed incompatible write.', (label, body) =>
    {
        const source = methodSource(body, owner, 'Number read(Number value)');
        expect(compileErrors(source).map(error => error.message)).toEqual(['Cannot assign String to Number.']);
    });

    test.each([
        [ 'mixed nullable write', 'value = ready ? "wrong" : null;\nreturn value;' ],
        [ 'later allowed nullable write', 'value = "wrong";\nvalue = null;\nreturn value;' ]
    ])('Preserves a nonnullable return diagnostic after a %s.', (label, body) =>
    {
        const source = methodSource(body, owner, 'Number read(Number value)');
        expect(compileErrors(source).map(error => error.message)).toEqual([
            'Cannot assign String to Number.', 'Cannot return null from a Number method.'
        ]);
    });

    test('Keeps rejected compound origins separate from another binding and direct String returns.', () =>
    {
        const source = methodSource('value += "wrong";\nString copied = value;\nreturn "direct";', owner, 'Number read(Number value)');
        expect(compileErrors(source).map(error => error.message)).toEqual([
            'Cannot assign String to Number.', 'Cannot assign Number to String.', 'Cannot return String from a Number method.'
        ]);
    });

    test('Does not recover a later unannotated binding or an unknown write from an earlier rejection.', () =>
    {
        const source = methodSource('value = "wrong";\nlet copied = value;\ncopied = "current";\nvalue = external();\nreturn copied;', owner, 'Number read(Number value)');
        expect(compileErrors(source).map(error => error.message)).toEqual([
            'Cannot assign String to Number.', 'Cannot return String from a Number method.'
        ]);
    });

    test('Distinguishes a nullable parameter value from its declared return type.', () =>
    {
        const source = methodSource('value = null;\nreturn value;', owner, 'Number read(Number value)');
        expectSourceDiagnostic(source, {
            message: 'Cannot return null from a Number method.',
            marker: 'return value;',
            shift: 'return '.length,
            length: 'value'.length
        });
    });

    test.each([
        [ 'short-circuited logical or writes', 'let value = 1;\nvalue ||= "unreachable";\nreturn value;' ],
        [ 'short-circuited logical and writes', 'let value = 0;\nvalue &&= "unreachable";\nreturn value;' ],
        [ 'short-circuited nullish writes', 'let value = 1;\nvalue ??= "unreachable";\nreturn value;' ],
        [ 'nullish repairs', 'let value = null;\nvalue ??= 1;\nreturn value;' ],
        [ 'logical or repairs', 'let value = "";\nvalue ||= 1;\nreturn value;' ],
        [ 'sequential repairs', 'let value = "wrong";\nvalue = 1;\nreturn value;' ],
        [ 'repairs on every branch', 'let value = "wrong";\nif(ready) value = 1; else value = 2;\nreturn value;' ],
        [ 'null initializer repairs', 'Number value = null;\nvalue = 1;\nreturn value;' ],
        [ 'null reassignment repairs', 'Number value = 1;\nvalue = null;\nvalue = 2;\nreturn value;' ],
        [ 'writes after a return', 'let value = 1;\nreturn value;\nvalue = "later";' ],
        [ 'writes on later terminating paths', 'let value = 1;\nif(ready) return value;\nvalue = "later";\nthrow new Error("stop");' ],
        [ 'unreachable branches', 'let value = 1;\nif(false) value = "unreachable";\nreturn value;' ],
        [ 'deferred callback writes', 'let value = 1;\nconst callback = () => { value = "later"; };\nreturn value;' ],
        [ 'unknown reassignment results', 'let value = "text";\nvalue = external();\nreturn value;' ],
        [ 'shadowed block locals', 'let value = "outer";\n{ const value = 1; return value; }' ],
        [ 'destructured local repairs', 'let value = "text";\n[value] = [1];\nreturn value;' ]
    ])('Accepts %s without adding a return false alarm.', (label, body) =>
    {
        expect(compileErrors(methodSource(body, owner))).toEqual([]);
    });

    test('Does not inherit an outer method parameter contract into a nested callback.', () =>
    {
        const source = methodSource('const callback = value => { value = "text"; return value; };\nreturn value;', owner, 'Number read(Number value)');
        expect(compileErrors(source)).toEqual([]);
    });

    test('Preserves the distinction between rest bindings and element annotations on returns.', () =>
    {
        const source = methodSource('values = [1, 2];\nreturn values;', owner, 'Array read(...Number values)');
        expect(compileErrors(source)).toEqual([]);
    });
});

describe('LGD rejected-write recovery and strict runtime proof.', () =>
{
    test.each([ 'oloo', 'class' ])('keeps exactly the screenshot assignment blocker in the %s model', javascriptObjectModel =>
    {
        const source = 'export {};\r\nclass Counter { Number increment(Number value) { value = "wrong"; return value; } }';
        const errors = compileErrors(source, javascriptObjectModel);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'lgd.assignment.typeMismatch', message: 'Cannot assign String to Number.' });
        expect(source.slice(errors[0].offset, errors[0].endOffset)).toBe('"wrong"');
    });

    test('requires diagnosed assignment provenance before recovery and never uses it for String-only return proof', () =>
    {
        const source = 'export {};\r\nclass Counter { Number increment(Number value) { value = "wrong"; return value; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { deferAnalysis: true });
        const context = LgdReturnChecker.createContext(source, result.allDeclarations, { code: result.code, segments: result.mappings });
        expect(LgdReturnChecker.check(context).map(error => error.code)).toEqual(['lgd.return.typeMismatch']);
        expect(LgdAssignmentChecker.check(context).map(error => error.code)).toEqual(['lgd.assignment.typeMismatch']);
        expect(LgdReturnChecker.check(context)).toEqual([]);
        const signature = context.signatures[0];
        const bodyStart = context.map.toOutput(signature.declaration.initializerStart + signature.group.bodyStart);
        let provedString = false;
        let provedNumber = false;
        traverse(context.tree, {
            /** @description Verifies actual-value proof on the exact method already checked with diagnostic recovery. */
            Function: method =>
            {
                if(method.node.body.start === bodyStart)
                {
                    provedString = LgdReturnChecker.returnsOnly(method, signature, context, 'String');
                    provedNumber = LgdReturnChecker.returnsOnly(method, signature, context, 'Number');
                }
            }
        });
        expect(provedString).toBe(true);
        expect(provedNumber).toBe(false);
        expect(LgdAssignmentChecker.check(context).map(error => error.code)).toEqual(['lgd.assignment.typeMismatch']);
    });
});

describe('LGD async suspension and captured writes.', () =>
{
    test('Does not report a stale local value after a queued captured repair runs during await.', async () =>
    {
        const source = methodSource([
            'let value = "wrong";',
            'const repair = () => { value = 1; };',
            'queueMicrotask(repair);',
            'value = "wrong";',
            'await 0;',
            'return value;'
        ].join('\n'), 'object', 'async Number read()');
        const result = LgdCompiler.create().compileToJs(source);
        const actual = await virtualMachine.runInNewContext(`${result.code}\nCounter.read();`, { queueMicrotask: queueMicrotask });
        expect(actual).toBe(1);
        expect(result.errors).toEqual([]);
    });

    test('Still rejects an incompatible awaited local with no external captured writer.', () =>
    {
        const source = methodSource('let value = "wrong";\nawait 0;\nreturn value;', 'object', 'async Number read()');
        expectSourceDiagnostic(source, {
            message: 'Cannot return String from a Number method.',
            marker: 'return value;',
            shift: 'return '.length,
            length: 'value'.length
        });
    });
});

describe('LGD numeric update kinds.', () =>
{
    const expectedBigInt = 2n;
    const expectedNumber = 2;

    test.each([
        [ 'BigInt increments', 'BigInt read(BigInt value) { value++; return value; }', '1n', expectedBigInt ],
        [ 'coercive String increments', 'Number read() { let value = "1"; value++; return value; }', '', expectedNumber ]
    ])('Preserves %s in the emitted runtime.', (label, method, argument, expected) =>
    {
        const source = `Object Counter = {\n${method}\n};`;
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\nCounter.read(${argument});`)).toBe(expected);
    });

    test.each([
        [ 'Number', 'let value = 1n; value++; return value;', 'BigInt' ],
        [ 'String', 'let value = "1"; value--; return value;', 'Number' ]
    ])('Rejects a %s return when updates produce another numeric kind.', (declared, body, inferred) =>
    {
        const source = methodSource(body, 'object', `${declared} read()`);
        expectSourceDiagnostic(source, {
            message: `Cannot return ${inferred} from a ${declared} method.`,
            marker: 'return value;',
            shift: 'return '.length,
            length: 'value'.length
        });
    });
});

describe('LGD reviewed lexical and completion edges.', () =>
{
    test.each([
        [ 'sibling nominal Item scopes', 'Function first = () => {\n    Object Item = {};\n    Item copy = Item;\n};\nFunction second = () => {\n    Number Item = 1;\n    Item copy = Item;\n};' ],
        [ 'a sibling local named Number', 'Function first = () => {\n    String Number = "wrong";\n};\nNumber total = 1 + 2;\nObject Counter = { Number read() { return 1 + 2; } };' ],
        [ 'callback parameters inside typed defaults', 'Function run = (Number value = (value => { value = "allowed"; return 1; })(0)) => value;' ],
        [ 'an impossible switch default', methodSource('let value = 1;\nswitch(1) { case 1: break; default: value = "wrong"; }\nreturn value;', 'object') ],
        [ 'empty object iteration', methodSource('let value = 1;\nfor(const key in {}) { value = "wrong"; }\nreturn value;', 'object') ],
        [ 'empty array iteration', methodSource('let value = 1;\nfor(const item of []) { value = "wrong"; }\nreturn value;', 'object') ]
    ])('Accepts %s without borrowing unrelated types or impossible writes.', (label, source) =>
    {
        expect(compileErrors(source)).toEqual([]);
    });

    test('Rejects a self-nominal binding after its value becomes null.', () =>
    {
        const source = 'Item Item = {};\nObject Counter = { Item read() { Item = null; return Item; } };';
        expectSourceDiagnostic(source, {
            message: 'Cannot return null from a Item method.',
            marker: 'return Item;',
            shift: 'return '.length,
            length: 'Item'.length
        });
    });
});

describe('LGD replaced method contracts.', () =>
{
    test.each([
        [ 'a rebound object', 'Object Factory = { String read() { return "wrong"; } };\n(Factory = { read() { return 1; } });\nObject Counter = { Number read() { return Factory.read(); } };' ],
        [ 'a replaced member', 'Object Factory = { String read() { return "wrong"; } };\nFactory.read = () => 1;\nObject Counter = { Number read() { return Factory.read(); } };' ]
    ])('Leaves %s unknown instead of reusing its original String return contract.', (label, source) =>
    {
        const result = LgdCompiler.create().compileToJs(source);
        expect(virtualMachine.runInNewContext(`${result.code}\nCounter.read();`)).toBe(1);
        expect(result.errors).toEqual([]);
    });
});

describe('LGD implicit execution invalidates captured value proofs.', () =>
{
    test.each([
        [ 'getter reads', 'const holder = { get amount() { value = 1; return 0; } };\nconst ignored = holder.amount;' ],
        [ 'tagged templates', 'const repair = () => { value = 1; return ""; };\nrepair`text`;' ],
        [ 'destructuring getters', 'const holder = { get amount() { value = 1; return 0; } };\nconst { amount } = holder;' ],
        [ 'custom numeric coercion', 'const holder = { valueOf() { value = 1; return 0; } };\n+holder;' ],
        [ 'literal direct eval repairs', 'eval("value = 1");' ]
    ])('Avoids stale String return alarms after %s.', (label, statements) =>
    {
        const source = methodSource(`let value = "wrong";\n${statements}\nreturn value;`, 'object');
        const result = LgdCompiler.create().compileToJs(source);
        expect(virtualMachine.runInNewContext(`${result.code}\nCounter.read();`)).toBe(1);
        expect(result.errors).toEqual([]);
    });
});

describe('LGD destructuring inherited object values.', () =>
{
    test.each([
        [ 'prototype values', 'Number', '({ value = "wrong" } = { __proto__: { value: 1 } });', 'number' ],
        [ 'Object.prototype methods', 'Function', '({ toString: value = "wrong" } = {});', 'function' ]
    ])('Does not activate a String default when %s supply the property.', (label, declared, statement, expectedKind) =>
    {
        const source = methodSource(`${statement}\nreturn value;`, 'object', `${declared} read(${declared} value)`);
        const result = LgdCompiler.create().compileToJs(source);
        const actual = virtualMachine.runInNewContext(`${result.code}\nCounter.read();`);
        expect(typeof actual).toBe(expectedKind);
        if(expectedKind === 'number')
        {
            expect(actual).toBe(1);
        }

        expect(result.errors).toEqual([]);
    });
});

describe('LGD supported return annotation boundaries.', () =>
{
    test.each([
        'Number read() { return 1; }',
        'async Number read() { return 1; }',
        'Function callback = () => { Number read() { return 1; } };'
    ])('Still rejects unsupported standalone return-first functions: %s.', source =>
    {
        const errors = compileErrors(source);
        expect(errors.some(error => error.message.startsWith('Standalone return-first'))).toBe(true);
    });
});
