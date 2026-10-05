const LgdFormatter = require('../../../../src/Lgd/Formatting/LgdFormatter');
const LgdFormattingModel = require('../../../../src/Lgd/Formatting/LgdFormattingModel');
const LgdFormattingOptions = require('../../../../src/Lgd/Formatting/LgdFormattingOptions');

/** @description Every fixture requires a stable second format and unchanged compiled executable structure. */
function format(source, options = {})
{
    const configuration = { options: options };
    const result = LgdFormatter.format(source, configuration);
    expect(LgdFormatter.format(result, configuration)).toBe(result);
    const before = LgdFormattingModel.create(source);
    const after = LgdFormattingModel.create(result);
    expect(Boolean(after)).toBe(Boolean(before));
    if(before)
    {
        expect(LgdFormattingModel.signature(after)).toBe(LgdFormattingModel.signature(before));
    }

    return result;
}

describe('LGD brace placement and style variations', () =>
{
    test.each([ 'attach', 'allman', 'stroustrup', 'linux', 'mozilla', 'webkit', 'gnu', 'whitesmiths', 'custom' ])('supports stable %s brace style', style =>
    {
        const result = format('function run() { if(ok) { act(); } else { stop(); } }', { braces: { style: style } });
        expect(result).toContain('act();');
    });

    test('separates class, constructor, method and accessor locations', () =>
    {
        const source = 'class View { View() { act(); } Number count() { return 1; } get label() { return "view"; } }';
        const result = format(source, { braces: { style: 'allman', wrapping: { classes: 'sameLine', constructors: 'sameLine', methods: 'nextLine', accessors: 'sameLine' } } });
        expect(result).toContain('class View {');
        expect(result).toContain('View() {');
        expect(result).toContain('Number count()\n    {');
        expect(result).toContain('get label() {');
    });

    test('uses separate catch, finally, else and do-while continuation preferences', () =>
    {
        const source = 'try { act(); } catch(error) { handle(error); } finally { stop(); }\ndo { act(); } while(ok);';
        const result = format(source, { braces: { style: 'attach', beforeCatch: false, beforeFinally: true, beforeWhile: true } });
        expect(result).toContain('} catch(error) {');
        expect(result).toContain('}\nfinally {');
        expect(result).toContain('}\nwhile(ok);');
    });

    test('formats interfaces and enums without pretending semicolons are bodies', () =>
    {
        expect(format('interface IValue { Number value(); }')).toBe('interface IValue\n{\n    Number value();\n}');
        expect(format('enum State { Started = 1, Done = 2 }')).toContain('enum State\n{');
    });

    test('supports multiline-only custom control wrapping', () =>
    {
        const result = format('if(ready &&\nvalid) { act(); }', { braces: { style: 'attach', wrapping: { controlBlocks: 'nextLineIfMultiline' } }, wrapping: { binaryOperations: 'preserve' } });
        expect(result).toContain('valid)\n{');
    });
});

describe('spacing, indentation and layout', () =>
{
    test('uses compact parentheses and spaced return defaults without explicit style rules', () =>
    {
        const source = 'function choose(value, fallback){return(value ?? (fallback));}\nfunction isReady(value){return !!(value);}';
        const result = format(source);
        expect(result).toContain('function choose(value, fallback)');
        expect(result).toContain('return (value ?? (fallback));');
        expect(result).toContain('return !!(value);');
        const controls = format('if(ready){read(value);empty();}');
        expect(controls).toContain('if(ready)');
        expect(controls).toContain('read(value);');
        const empty = format('function empty(){call();}');
        expect(empty).toContain('empty()');
        expect(empty).toContain('call();');
        expect(format('Number value=(Number) "2";')).toContain('(Number)"2"');
    });

    test.each([ false, true ])('honors %s padding independently in every parenthesis context', padding =>
    {
        const source = 'class Example { Example(Number first, Number second) {} Number add(Number first, Number second) { if(first) { while(second) { call(first, second); break; } } for(let index = 0; index < 1; index++) { call(); } return(Number)(first + second); } Number empty() { return read(); } }';
        const spacing = { insideDeclarationParens: padding, insideCallParens: padding, insideControlParens: padding, insideCastParens: padding, insideOtherParens: padding,
            insideEmptyDeclarationParens: padding, insideEmptyCallParens: padding };
        const result = format(source, { spacing: spacing });
        const edge = padding ? ' ' : '';
        expect(result).toContain(`Example(${edge}Number first, Number second${edge})`);
        expect(result).toContain(`add(${edge}Number first, Number second${edge})`);
        expect(result).toContain(`if(${edge}first${edge})`);
        expect(result).toContain(`while(${edge}second${edge})`);
        expect(result).toContain(`for(${edge}let index = 0; index < 1; index++${edge})`);
        expect(result).toContain(`call(${edge}first, second${edge});`);
        expect(result).toContain(`return (${edge}Number${edge})(${edge}first + second${edge});`);
        expect(result).toContain(`empty(${edge})`);
        expect(result).toContain(`read(${edge});`);
    });

    test('allows explicit false and family true choices independently of compact defaults', () =>
    {
        const source = 'function run(value){if(value){return(read(value));}}';
        const options = { spacing: { afterReturnKeyword: false, insideDeclarationParens: false, insideControlParens: false, insideCallParens: false, insideOtherParens: false } };
        const result = format(source, options);
        expect(result).toContain('function run(value)');
        expect(result).toContain('if(value)');
        expect(result).toContain('return(read(value));');
        expect(format('function run(value){return value;}', options)).toContain('return value;');
        const configuration = { options: { spacing: { insideOtherParens: false } }, rules: { 'lgd.format.spacing': { options: { insideOtherParens: true, afterReturnKeyword: false } } } };
        const overridden = LgdFormatter.format(source, configuration);
        expect(overridden).toContain('return( read(value) );');
        expect(LgdFormatter.format(overridden, configuration)).toBe(overridden);
    });

    test('distinguishes genuine return grouping from a method named return', () =>
    {
        const source = 'const receiver = { return(value){return(value);} };receiver.return(value);';
        const result = format(source, { spacing: { beforeCallParen: false, insideCallParens: false, insideOtherParens: true } });
        expect(result).toContain('return(value)');
        expect(result).toContain('return ( value );');
        expect(result).toContain('receiver.return(value);');
        const findings = LgdFormatter.analyze('function run(value){return( value );}', { options: { spacing: { insideCallParens: false } } });
        expect(findings.some(finding => finding.ruleId === 'lgd.format.spacing.afterReturnKeyword')).toBe(true);
        expect(findings.some(finding => finding.ruleId === 'lgd.format.spacing.insideOtherParens')).toBe(true);
    });

    test('has independent control, declaration and call parenthesis spacing', () =>
    {
        const result = format('function run(first,second){if(first){call(first,second);}}', { spacing: { afterControlKeywords: true, insideControlParens: true, beforeFunctionParen: true, insideDeclarationParens: true, insideCallParens: true } });
        expect(result).toContain('function run ( first, second )');
        expect(result).toContain('if ( first )');
        expect(result).toContain('call( first, second )');
    });

    test('keeps lexical type and identifier boundaries when no binary spaces are selected', () =>
    {
        const result = format('function run() { return left + right * value; }', { spacing: { binaryOperators: 'none' } });
        expect(result).toContain('return left+right*value;');
    });

    test('supports independent comma and member access spacing', () =>
    {
        const result = format('function run(){call(first,second);object.value;}', { spacing: { beforeComma: true, afterComma: false, beforeDot: true, afterDot: true } });
        expect(result).toContain('call(first ,second);');
        expect(result).toContain('object . value;');
    });

    test('formats for-semicolon and square bracket spaces independently', () =>
    {
        const result = format('for(let index=0;index<4;index++){read(items[index]);}', { spacing: { beforeForSemicolon: true, afterForSemicolon: false, beforeSquareBracket: true, insideSquareBrackets: true } });
        expect(result).toContain('index = 0 ;index < 4 ;index++');
        expect(result).toContain('items [ index ]');
    });

    test('supports heritage-colon spacing without changing object or label colons', () =>
    {
        const result = format('class Base {}\nclass View : Base {}', { spacing: { beforeInheritanceColon: false, afterInheritanceColon: false } });
        expect(result).toContain('class View:Base');
    });

    test('formats object interior spacing and independent empty block spacing', () =>
    {
        const result = format('const Object settings={ active: true };\nfunction run(){}', { spacing: { insideObjectBraces: false, insideEmptyBlockBraces: false } });
        expect(result).toContain('{active: true}');
        expect(result).toContain('function run() {}');
    });

    test('uses tabs plus spaces for incomplete indentation widths', () =>
    {
        const result = format('function run(){if(ok){act();}}', { indentation: { style: 'tab', size: 6, tabWidth: 4 } });
        expect(result).toContain('\n\t  if(ok)');
        expect(result).toContain('\n\t\t\tact();');
    });

    test.each([ 'never', 'empty', 'inline', 'all', 'preserve' ])('keeps short-function %s stable', shortFunctions =>
    {
        expect(format('function run() { return 1; }', { lineBreaks: { shortFunctions: shortFunctions } })).toContain('return 1;');
    });

    test.each([ 'never', 'empty', 'inline', 'all', 'preserve' ])('keeps short-lambda %s stable', shortLambdas =>
    {
        expect(format('const Function run = (value) => { return value; };', { lineBreaks: { shortLambdas: shortLambdas } })).toContain('return value;');
    });

    test.each([ 'preserve', 'onePerLine', 'singleLine' ])('keeps object-member %s layout stable', objectMembers =>
    {
        expect(format('const Object settings = { first: 1, second: 2 };', { lineBreaks: { objectMembers: objectMembers } })).toContain('second: 2');
    });

    test('keeps empty lines only when requested at block boundaries', () =>
    {
        const source = 'function run()\n{\n\n    act();\n\n}';
        expect(format(source, { lineBreaks: { emptyLinesAtBlockStart: true, emptyLinesAtBlockEnd: true } })).toBe(source);
        expect(format(source)).not.toContain('\n\n');
    });
});

describe('wrapping and whitespace', () =>
{
    test.each([ 'onePerLine', 'binPack' ])('wraps arguments using %s', argumentsStyle =>
    {
        const result = format('const Number result = call(firstArgument, secondArgument, thirdArgument);', { wrapping: { arguments: argumentsStyle, columnLimit: 40 } });
        expect(result).toContain(',\n');
    });

    test('keeps short functions stable around the column limit', () =>
    {
        expect(format('function go(a,b) { return a+b; }', { lineBreaks: { shortFunctions: 'all' }, wrapping: { columnLimit: 30 } })).toContain('go(a, b)\n{');
    });

    test.each([ 'before', 'after', 'beforeNonAssignment' ])('relocates wrapped binary operators %s', binaryOperators =>
    {
        expect(format('const Boolean ready = first &&\nsecond;', { wrapping: { binaryOperators: binaryOperators, binaryOperations: 'preserve' } })).toContain('second');
    });

    test('formats CRLF endings and final-newline choices outside opaque text', () =>
    {
        const result = format('function run() {\n    act();   \n}\n', { whitespace: { endOfLine: 'crlf', finalNewline: 'never' } });
        expect(result).toContain('\r\n');
        expect(result.endsWith('\n')).toBe(false);
        expect(result).not.toContain('   \r\n');
    });

    test('does not add a newline to an empty file', () =>
    {
        expect(format('', { whitespace: { finalNewline: 'always' } })).toBe('');
    });

    test('tracks exact source text and all contributing per-option policies', () =>
    {
        const source = 'function run(){act();}';
        const changes = LgdFormatter.analyze(source, { rules: { 'lgd.format.braces': { severity: 'error' }, 'lgd.format.braces.functions': { fix: 'manual' } } });
        for(const change of changes)
        {
            expect(source.slice(change.offset, change.endOffset)).toBe(change.expectedText);
            expect(LgdFormattingOptions.optionRules.some(rule => rule.id === change.ruleId)).toBe(true);
        }

        expect(changes.find(change => change.ruleId === 'lgd.format.braces.functions').severity).toBe('error');
        expect(changes.some(change => change.relatedRuleIds.includes('lgd.format.lineBreaks.shortFunctions'))).toBe(true);
    });
});

/** @description Exercises every declared scalar choice against mixed LGD syntax to catch option interaction drift. */
const optionCases = LgdFormattingOptions.catalog.flatMap(rule => Object.entries(rule.properties).flatMap(([ option, schema ]) =>
{
    let values = schema.enum;
    if(schema.type === 'boolean')
    {
        values = [ false, true ];
    }
    else if(schema.type === 'integer')
    {
        values = [...new Set([ schema.minimum, rule.defaults[option], schema.maximum ])];
    }

    return (values || []).map(value => [ rule.id.slice('lgd.format.'.length), option, value ]);
}));

test.each(optionCases)('keeps %s.%s=%s idempotent across mixed syntax', (group, option, value) =>
{
    const source = [
        'class Base {}',
        'class Tool : Base { Tool() : base() {} Number apply(Number first, Number second) { return first + second; } get label() { return "tool"; } }',
        'function run(first, second) { if(first) { action(first, second, thirdArgument); } else { stop(); } for(let index = 0; index < 2; index++) { action(index); } }',
        'switch(current) { case 1: { stop(); break; } default: break; }',
        'const Object settings = { first: 1, second: 2 };',
        'const Function callback = (value) => { return value; };'
    ].join('\n');
    format(source, { [group]: { [option]: value } });
});
