const FileParser = require('../../../src/Parsers/FileParser');
const ClassParser = require('../../../src/Parsers/ClassParser');
const FunctionComponentParser = require('../../../src/Parsers/FunctionComponentParser');
const typescript = require('typescript-test-5-9');

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

test('nested objects retain file-level constant declarations', async () =>
{
    parser.content = `const COUNT = 1;
const LABEL = "example";`;
    const value = `{
  settings: {
    count: COUNT,
    labels: [LABEL, LABEL]
  }
}`;
    const type = await parser.parseValue(value);
    expect(type).toContain('count: number;');
    expect(type).toContain('labels: string[];');
});

test('nested source propagation stops recursive constant-backed objects', async () =>
{
    parser.content = `const NODE = {
  child: NODE
};`;
    const type = await parser.parseValue('NODE');
    expect(type).toContain('child: any;');
});

describe.each([ 'factory', 'constructor' ])('parameter and local variable types in a %s', initialization =>
{
    let classParser;
    beforeEach(() =>
    {
        classParser = ClassParser.create();
    });

    async function generateDeclarations(body, parameters = 'document', annotation = '/** @param {DocumentType} document */')
    {
        if(initialization === 'constructor')
        {
            const source = `class Example extends Parent {
  ${annotation}
  constructor(${parameters}) {
${body.replace(/instance\./g, 'this.')}
  }
}`;

            return (await classParser.parse(source, '')).typeFile;
        }

        const source = `const Example = {
  ${annotation}
  create(${parameters}) {
    const instance = Object.create(Example);
${body}
    return instance;
  }
};`;

        return await parser.parse('', source);
    }

    test('propagates parameter types, local annotations, aliases, and array element types into nested objects', async () =>
    {
        const result = await generateDeclarations(`    const current = document;
    const logger = Logger.create();
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    const labels = ["first", "second"];
    instance.context = {
      document: current,
      diagnostics: diagnostics,
      labels: labels,
      nested: {
        logger: logger,
        documents: [current]
      }
    };`);
        expect(result).toContain('document: DocumentType;');
        expect(result).toContain('diagnostics: Diagnostic[];');
        expect(result).toContain('labels: string[];');
        expect(result).toContain('logger: LoggerType;');
        expect(result).toContain('documents: DocumentType[];');
    });

    test('does not use outer variable types for nested method parameters or returns', async () =>
    {
        const result = await generateDeclarations(`    instance.context = {
      convert(document, current = document) {
        return document;
      },
      document: document
    };`);
        expect(result).toContain('convert(document: any, current: any): any;');
        expect(result).toContain('document: DocumentType;');
    });

    test('infers default parameter types', async () =>
    {
        const result = await generateDeclarations('    instance.count = count;', 'count = 3', '');
        expect(result).toContain('count: number;');
    });

    test('does not trust a parameter annotation after reassignment', async () =>
    {
        const result = await generateDeclarations(`    document = "changed";
    const current = document;
    instance.context = {
      document: document,
      documents: [current]
    };`);
        expect(result).toContain('document: any;');
        expect(result).toContain('documents: any[];');
    });

    test('does not trust annotations on reassigned, forward, or uninitialized locals', async () =>
    {
        const result = await generateDeclarations(`    /** @type {string} */
    let changed = "first";
    changed = 42;
    /** @type {DocumentType} */
    let missing;
    instance.context = {
      changed: changed,
      forward: later,
      missing: missing
    };
    /** @type {number} */
    const later = 1;`);
        expect(result).toContain('changed: any;');
        expect(result).toContain('forward: any;');
        expect(result).toContain('missing: any;');
    });

    test.each([
        '/* explanation */ ',
        `// explanation
    `
    ])('infers assigned types when comments surround the value: %s', async comment =>
    {
        const result = await generateDeclarations(`    instance.document = ${comment}(document) /* trailing */;
    instance.documents = ${comment}[document];
    instance.context = ${comment}{
      document: /* nested */ document
    };`);
        expect(result).toContain('document: DocumentType;');
        expect(result).toContain('documents: DocumentType[];');
        expect(result).toContain('static document: DocumentType;');
    });

    test('uses the nearest variable declaration and keeps function variables out of static properties', async () =>
    {
        const result = await generateDeclarations(`    {
      const document = "local";
      instance.label = document;
    }
    instance.document = document;`);
        expect(result).toContain('label: string|undefined;');
        expect(result).toContain('document: DocumentType;');
        const source = `const Other = {
  document: document
};`;
        expect(await parser.parse('', source)).toContain('document: any;');
    });

    test('restores indentation and forgets function variables after a failed full parse', async () =>
    {
        const body = `    const documents = [document];
    instance.documents = documents;`;
        const activeParser = initialization === 'constructor' ? classParser : parser;
        const failure = new Error('Array parsing failed');
        const parseArray = jest.spyOn(activeParser, 'parseArray').mockRejectedValueOnce(failure);
        try
        {
            await expect(generateDeclarations(body)).rejects.toBe(failure);
        }
        finally
        {
            parseArray.mockRestore();
        }

        expect(await activeParser.parseValue('document')).toBe('any');
        const result = await generateDeclarations(body);
        expect(result).toContain('documents: DocumentType[];');
    });

    test('does not infer stale, forward, cyclic, or unrelated local values', async () =>
    {
        const result = await generateDeclarations(`    let changed = "first";
    changed = 42;
    const first = second;
    const second = first;
    function unrelated() {
      const hidden = "hidden";
    }
    instance.context = {
      changed: changed,
      forward: later,
      cycle: first,
      hidden: hidden
    };
    const later = 1;`);
        expect(result).toContain('changed: any;');
        expect(result).toContain('forward: any;');
        expect(result).toContain('cycle: any;');
        expect(result).toContain('hidden: any;');
    });
});

test('uses parameter annotations and defaults in function component constructors', async () =>
{
    const source = `
  /** @param {DocumentType} document */
  constructor(document, count = 3) {
    const current = document;
    this.context = {
      document: current
    };
    this.count = count;
  }
`;
    const componentParser = FunctionComponentParser.create();
    componentParser.variables = {};
    componentParser.staticVariables = [];
    componentParser.className = 'Example';
    componentParser.isReactComponent = true;
    componentParser.content = source;
    const result = await componentParser.parseClass(source);

    expect(result).toContain('document: DocumentType;');
    expect(result).toContain('count: number;');
});

test('restores indentation before reusing a constructor parser after an error', async () =>
{
    const source = `    const documents = [document];
    this.documents = documents;`;
    const classParser = ClassParser.create();
    classParser.className = 'Example';
    classParser.variables = {};
    classParser.staticVariables = [];
    classParser.tabSize = 2;
    const parameterTypes = { document: 'DocumentType' };
    const failure = new Error('Array parsing failed');
    const parseArray = jest.spyOn(classParser, 'parseArray').mockRejectedValueOnce(failure);
    try
    {
        await expect(classParser.parseCreate(source, '(document)', parameterTypes)).rejects.toBe(failure);
    }
    finally
    {
        parseArray.mockRestore();
    }

    const result = await classParser.parseCreate(source, '(document)', parameterTypes);
    expect(result).toContain('documents: DocumentType[];');
});

test('keeps each parser\'s variables separate when sharing a compilation context', async () =>
{
    const source = `const Factory = {
  /** @param {DocumentType} document */
  create(document) {
    const instance = Object.create(Factory);
    const current = document;
    instance.document = current;
    return instance;
  }
};
class Example extends Parent {
  /** @param {OtherType} document */
  constructor(document) {
    const current = document;
    this.document = current;
  }
}`;
    const compilationContext = { source: source, logger: lgd.logger };
    const fileParser = FileParser.create(compilationContext);
    const classParser = ClassParser.create(compilationContext);
    const [ factoryTypes, classTypes ] = await Promise.all([
        fileParser.parse('', source),
        classParser.parse(source, '')
    ]);

    expect(factoryTypes).toContain('document: DocumentType;');
    expect(classTypes.typeFile).toContain('document: OtherType;');
});

test.each([ 'OtherType', 'Example', 'ExampleType' ])('preserves the Promise contract for %s', async type =>
{
    parser.className = 'Example';
    parser.content = `/**
 * @template Item
 */
const Example = {
};`;
    const result = parser.getTypeWithTemplates(type);
    expect(result).toBeInstanceOf(Promise);
    const expected = type === 'OtherType' ? 'OtherType' : 'ExampleType<Item>';
    expect(await result).toBe(expected);
});

test('expands template types through the active JSDoc caller', async () =>
{
    parser.className = 'Example';
    parser.content = `/**
 * @template Item
 */
const Example = {
};`;
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
        const source = `const Example = {
  value: ${expression}
};`;
        expect(await parser.parse('', source)).toContain(`static value: ${expected};`);
    });

    test('array element type', async () =>
    {
        const source = `const Example = {
  values: [${expression}, ${expression}]
};`;
        expect(await parser.parse('', source)).toContain(`static values: ${expected}[];`);
    });

    test('function return type', async () =>
    {
        const source = `const Example = {
  result() {
    return ${expression};
  }
};`;
        expect(await parser.parse('', source)).toContain(`result(): ${expected};`);
    });

    test('default parameter type', async () =>
    {
        const source = `const Example = {
  result(value = ${expression}) {
  }
};`;
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

test.each([
    [ '{ value = 1 }', '({ value }: any)' ],
    [ '[first = 1]', '([first]: any)' ],
    [ '{ value = 1 } = {}', '({ value }: any)' ],
    [ '[first = 1] = []', '([first]: any)' ],
    [ '{ outer: { inner = 1 } = {}, ...rest }', '({ outer: { inner }, ...rest }: any)' ],
    [ '[first = 1, , { label = "x" } = {}, ...rest]', '([first, , { label }, ...rest]: any)' ],
    [ '[first = 1, ,]', '([first, ,]: any)' ],
    [ '{ "a=b": value = 1 }', '({ "a=b": value }: any)' ],
    [ '{ ["a=b"]: value = 1 }', '({ ["a=b"]: value }: any)' ],
    [ '...[first = 1, ...rest]', '(...[first, ...rest]: any[])' ],
    [ 'value /* = comment */ = 2', '(value: number)' ]
])('emits valid declarations for parameter bindings: %s', async (parameters, expected) =>
{
    const source = `const Example = {
  run(${parameters}) {
  }
};`;
    const declaration = await parser.parse('', source);
    expect(declaration).toContain(`run${expected}: void;`);
    const parsedDeclaration = typescript.createSourceFile('Example.d.ts', declaration, typescript.ScriptTarget.Latest, true);
    expect(parsedDeclaration.parseDiagnostics).toEqual([]);
});

test.each([
    [ undefined, 'any[]' ],
    [ 'number', 'number[]' ],
    [ 'number[]', 'number[]' ],
    [ 'Array<number>', 'Array<number>' ],
    [ 'ReadonlyArray<number>', 'ReadonlyArray<number>' ],
    [ '[number, string]', '[number, string]' ],
    [ 'readonly number[]', 'readonly number[]' ],
    [ 'keyof number[]', '(keyof number[])[]' ],
    [ '() => void', '(() => void)[]' ],
    [ 'number | string', '(number | string)[]' ],
    [ 'number | string[]', '(number | string[])[]' ],
    [ 'number[] | string[]', 'number[] | string[]' ],
    [ '...number', 'number[]' ]
])('emits a valid rest parameter using its JSDoc name and type: %s', async (annotation, expected) =>
{
    const commentParams = { values: annotation };
    expect(await parser.functionParser.parseFunctionParams('prefix = "x", ...values', commentParams)).toBe(`(prefix: string, ...values: ${expected})`);
});

test.each([ 'number', 'number[]' ])('preserves documented rest parameters in generated declarations: %s', async annotation =>
{
    const source = `const Example = {
  /** @param {${annotation}} values */
  result(...values) {
  }
};`;
    expect(await parser.parse('', source)).toContain('result(...values: number[]): void;');
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
        const source = `const Example = {
  values: ${expression},
  next: true
};`;
        expect(await parser.parse('', source)).toContain(`static values: ${expected};`);
    });

    test.each([ ClassParser, FunctionComponentParser ])('class field parser %#', async parserDefinition =>
    {
        const classParser = parserDefinition.create();
        classParser.variables = {};
        classParser.staticVariables = [];
        const source = `
  values = ${expression};
  next = true;
`;
        expect(await classParser.parseClass(source)).toContain(`values: ${expected};`);
    });

    test('class constructor assignments', async () =>
    {
        const source = `class Example extends Parent {
  constructor() {
    this.values = ${expression};
  }
}`;
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
