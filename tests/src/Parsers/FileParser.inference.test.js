const FileParser = require('../../../src/Parsers/FileParser');
const ClassParser = require('../../../src/Parsers/ClassParser');
const FunctionComponentParser = require('../../../src/Parsers/FunctionComponentParser');

let previousLgd;
let parser;

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    globalThis.lgd = {
        configuration: { tabSize: 2 },
        logger: { logInfo: jest.fn(), logWarning: jest.fn(), logError: jest.fn() }
    };
    parser = FileParser.create();
});

afterEach(() =>
{
    globalThis.lgd = previousLgd;
});

test.each([ 'OtherType', 'Example', 'ExampleType' ])('preserves the Promise contract for %s', async type =>
{
    parser.className = 'Example';
    parser.content = '/**\n * @template Item\n */\nconst Example = {\n};';
    const result = parser.getTypeWithTemplates(type);
    expect(result).toBeInstanceOf(Promise);
    const expected = type === 'OtherType' ? 'OtherType' : 'ExampleType<Item>';
    expect(await result).toBe(expected);
});

test('expands template types through the active JSDoc caller', async () =>
{
    parser.className = 'Example';
    parser.content = '/**\n * @template Item\n */\nconst Example = {\n};';
    const options = {};
    await parser.parseComment('/** @returns {Example} */', options);
    expect(options.type).toBe('ExampleType<Item>');
});

test('returns a Promise even when the template type is missing', async () =>
{
    parser.className = 'Example';
    parser.content = '';
    const result = parser.getTypeWithTemplates('Example');
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeUndefined();
});

test('reports template parsing failures as Promise rejections', async () =>
{
    parser.className = 'Example';
    parser.parseTypeWithTemplates = () =>
    {
        throw new Error('Template parsing failed');
    };

    await expect(parser.getTypeWithTemplates('Example')).rejects.toThrow('Template parsing failed');
});

describe.each([
    [ '1', 'number' ],
    [ '2 + 3 * 4', 'number' ],
    [ '2 < 3', 'boolean' ],
    [ '2 === 3', 'boolean' ],
    [ "'value' + 2", 'string' ],
    [ 'true && false', 'boolean' ],
    [ 'null + 1', 'number' ],
    [ 'true + 1', 'number' ],
    [ 'false && 5', 'boolean' ],
    [ '(2 > 1) ? 1 : "x"', 'number' ],
    [ 'Math.PI * 2', 'number' ],
    [ '1n + 2n', 'bigint' ],
    [ 'unknown > 0', 'boolean' ],
    [ 'flag ? 1 : 2', 'number' ],
    [ 'flag ? 1 : false', 'any' ],
    [ 'price + tax', 'any' ]
])('generated declarations for %s', (expression, expected) =>
{
    test('property type', async () =>
    {
        const source = `const Example = {\n  value: ${expression}\n};`;
        expect(await parser.parse('', source)).toContain(`static value: ${expected};`);
    });

    test('array element type', async () =>
    {
        const source = `const Example = {\n  values: [${expression}, ${expression}]\n};`;
        expect(await parser.parse('', source)).toContain(`static values: ${expected}[];`);
    });

    test('function return type', async () =>
    {
        const source = `const Example = {\n  result() {\n    return ${expression};\n  }\n};`;
        expect(await parser.parse('', source)).toContain(`result(): ${expected};`);
    });

    test('default parameter type', async () =>
    {
        const source = `const Example = {\n  result(value = ${expression}) {\n  }\n};`;
        expect(await parser.parse('', source)).toContain(`result(value: ${expected}): void;`);
    });
});

test('retains explicit parameter and return annotations', async () =>
{
    const source = `const Example = {
  /**
   * @param {CustomType} value
   * @returns {ResultType}
   */
  result(value = 1n + 2n) {
    return Math.PI * 2;
  }
};`;
    expect(await parser.parse('', source)).toContain('result(value: CustomType): ResultType;');
});

test('keeps parentheses, equality operators and quoted commas inside defaults', async () =>
{
    const source = `const Example = {
  result(radius = Math.PI * 2, count = (2 > 1) ? 1 : "x", label = "x,y", enabled = 1 === 1) {
  }
};`;
    expect(await parser.parse('', source)).toContain('result(radius: number, count: number, label: string, enabled: boolean): void;');
});

test.each([ '(value = 2 + 3)', 'value = 2 + 3' ])('accepts parameter lists with or without enclosing parentheses: %s', async parameters =>
{
    expect(await parser.functionParser.parseFunctionParams(parameters, {})).toBe('(value: number)');
});

describe.each([
    [ '[1, 2]', 'number[]' ],
    [ '[1, 2]  ', 'number[]' ],
    [ '[]', 'any[]' ],
    [ '["first", "second"]', 'string[]' ],
    [ '["first,second", "third"]', 'string[]' ],
    [ '[`first,second`, `third`]', 'string[]' ],
    [ '[new Example(1, 2), new Example(3, 4)]', 'Example[]' ],
    [ '[fn(1, 2), fn(3, 4)]', 'any[]' ],
    [ '["first", "second",]', 'string[]' ],
    [ '[true, false]', 'boolean[]' ],
    [ '[1, "second"]', '(number | string)[]' ],
    [ '[1n + 2n, 3n]', 'bigint[]' ]
])('array boundaries for %s', (expression, expected) =>
{
    test('object fields', async () =>
    {
        const source = `const Example = {\n  values: ${expression},\n  next: true\n};`;
        expect(await parser.parse('', source)).toContain(`static values: ${expected};`);
    });

    test.each([ ClassParser, FunctionComponentParser ])('class field parser %#', async parserDefinition =>
    {
        const classParser = parserDefinition.create();
        classParser.variables = {};
        classParser.staticVariables = [];
        const source = `\n  values = ${expression};\n  next = true;\n`;
        expect(await classParser.parseClass(source)).toContain(`values: ${expected};`);
    });

    test('class constructor assignments', async () =>
    {
        const source = `class Example extends Parent {\n  constructor() {\n    this.values = ${expression};\n  }\n}`;
        const result = await ClassParser.create().parse(source, '');
        expect(result.typeFile).toContain(`values: ${expected};`);
    });

    test('object factory assignments', async () =>
    {
        const source = `const Example = {
  create() {
    const example = Object.create(Example);
    example.values = ${expression};
    return example;
  }
};`;
        expect(await parser.parse('', source)).toContain(`values: ${expected};`);
    });
});

test.each([
    [ '"a\\",b", "c"', 'string[]' ],
    [ '"[first]", "second"', 'string[]' ],
    [ '(left, right) => left, (left, right) => right', 'Function[]' ],
    [ '1, /* comma, in comment */ 2', 'number[]' ],
    [ '"unfinished', 'any[]' ],
    [ '1, , 2', '(number | any)[]' ],
    [ '1, "second", 2, "third"', '(number | string)[]' ],
    [ 'new constructor(1, 2), new constructor(3, 4)', 'constructor[]' ],
    [ 'new length(1, 2)', 'length[]' ],
    [ '...new Example(1, 2)', 'any[]' ],
    [ '1], [2', 'any[]' ],
    [ '[1, 2], [3, 4]', '(any | any[])[]' ]
])('array splitting preserves complete expressions: %s', async (elements, expected) =>
{
    expect(await parser.parseArray(elements)).toBe(expected);
});
