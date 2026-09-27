const { execFileSync } = require('child_process');
const path = require('path');

function checkRule(ruleName, source)
{
    const script = `
        require('./scripts/register-eslint-rules')();
        const { Linter } = require('eslint');
        const ruleName = process.argv[1];
        const rule = require('./.vscode/eslint-rules/' + ruleName);
        const linter = new Linter();
        linter.defineParser('espree', require('espree'));
        linter.defineRule(ruleName, rule);
        const result = linter.verifyAndFix(JSON.parse(process.argv[2]), {
            parser: 'espree',
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
            rules: { [ruleName]: 'error' }
        });
        process.stdout.write(JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, [ '-e', script, ruleName, JSON.stringify(source) ], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8'
    });

    return JSON.parse(output);
}

test.each([ '(values)', '((values))', '(values.filter(Boolean))' ])('checks parenthesized chain links: %s', receiver =>
{
    const source = `${receiver}\r\n    .map(convert).filter(Boolean);`;
    const result = checkRule('consistent-chained-call-newline', source);
    expect(result.fixed).toBe(true);
    expect(result.output).toBe(`${receiver}\r\n    .map(convert)\r\n    .filter(Boolean);`);
    expect(result.messages).toEqual([]);
});

test('multiline callback bodies do not force inline chain links apart', () =>
{
    const source = 'values.map(value => {\r\n    return value;\r\n}).filter(Boolean);';
    const result = checkRule('consistent-chained-call-newline', source);
    expect(result.fixed).toBe(false);
    expect(result.output).toBe(source);
    expect(result.messages).toEqual([]);
});

test.each([
    [ 'description without parameter tags', 'const service = { /** Saves a value. */ save(value, options) {} };' ],
    [ 'description tag', 'class Service { /** @description Saves a value. */ save(value) {} }' ],
    [ 'description alias', 'class Service { /** @desc Saves. */ save() {} }' ],
    [ 'all parameter tags', 'const service = { /**\n * Saves a value.\n * @param {string} value\n * @param {object} options\n */ save(value, options) {} };' ],
    [ 'all names in a different order', 'class Service { /**\n * Saves a value.\n * @param options\n * @param value\n */ save(value, options) {} }' ],
    [ 'optional return tag', 'class Service { /**\n * Reads a value.\n * @returns {string}\n */ read() { return "value"; } }' ],
    [ 'default and rest parameters', 'class Service { /**\n * Saves values.\n * @param {string} [value="default"]\n * @param {...object} options\n */ save(value = "default", ...options) {} }' ],
    [ 'destructured roots and properties', 'const service = { /**\n * Saves options.\n * @param {{value: string}} options\n * @param {string} options.value\n * @param {string[]} entries\n */ save({value}, [first]) {} };' ],
    [ 'defaulted destructuring', 'class Service { /**\n * Configures a service.\n * @param {object} [options={}]\n */ configure({value} = {}) {} }' ],
    [ 'parameter aliases', 'class Service { /**\n * Saves a value.\n * @arg value\n * @argument options\n */ save(value, options) {} }' ],
    [ 'constructors', 'class Service { /** Creates a service. */ constructor(value) {} }' ],
    [ 'static async methods', 'class Service { /** Saves a value. */ static async save(value) {} }' ],
    [ 'accessors', 'class Service { /** Reads a value. */ get value() { return 1; } /** Writes a value. */ set value(value) {} }' ],
    [ 'object function properties', 'const service = { /** Saves a value. */ save: function(value) {}, /** Reads a value. */ read: () => 1 };' ],
    [ 'class function fields', 'class Service { /** Saves a value. */ save = value => value; /** Reads a value. */ static read = function() {}; }' ],
    [ 'computed and generator methods', 'class Service { /** Reads entries. */ *[Symbol.iterator]() { yield 1; } }' ],
    [ 'private names', 'class Service { #save(value) {} _read(value) {} #field = () => {}; } const service = { _save(value) {}, ["_read"]() {} };' ],
    [ 'private access markers', 'class Service { /** @private */ save(value) {} /** @protected */ read() {} /** @access private */ reset() {} }' ],
    [ 'functions and callbacks', 'function helper(value) {} const callback = value => value; values.map(value => value);' ],
    [ 'nonfunction properties', 'class Service { value = 1; } const service = { value: 1 };' ]
])('public method JSDoc accepts %s', (title, source) =>
{
    const result = checkRule('require-public-method-jsdoc', source);
    expect(result.messages).toEqual([]);
    expect(result.fixed).toBe(false);
});

test.each([
    [ 'undocumented class method', 'class Service { save(value) {} }', 'missing' ],
    [ 'undocumented object method', 'const service = { save(value) {} };', 'missing' ],
    [ 'ordinary comments', 'class Service { /* Saves a value. */ save(value) {} }', 'missing' ],
    [ 'empty JSDoc', 'class Service { /** */ save() {} }', 'description' ],
    [ 'empty description tag', 'class Service { /** @description */ save() {} }', 'description' ],
    [ 'parameter tags without a description', 'class Service { /** @param value */ save(value) {} }', 'description' ],
    [ 'return tag without a description', 'class Service { /** @returns {string} A value. */ read() {} }', 'description' ],
    [ 'partial parameter tags', 'class Service { /**\n * Saves a value.\n * @param value\n */ save(value, options) {} }', 'parameters' ],
    [ 'incorrect parameter name', 'class Service { /**\n * Saves a value.\n * @param other\n */ save(value) {} }', 'parameters' ],
    [ 'duplicate parameter tags', 'class Service { /**\n * Saves a value.\n * @param value\n * @param value\n */ save(value, options) {} }', 'parameters' ],
    [ 'extra parameter tags', 'class Service { /**\n * Reads a value.\n * @param value\n */ read() {} }', 'parameters' ],
    [ 'property tags on a parameterless method', 'class Service { /**\n * Reads a value.\n * @param options.value\n */ read() {} }', 'parameters' ],
    [ 'property tags without all roots', 'class Service { /**\n * Saves a value.\n * @param options\n * @param options.value\n */ save(options, value) {} }', 'parameters' ],
    [ 'undocumented destructured parameter', 'class Service { /**\n * Saves a value.\n * @param value\n */ save(value, {enabled}) {} }', 'parameters' ],
    [ 'malformed parameter tag', 'class Service { /**\n * Saves a value.\n * @param {string} [value\n */ save(value) {} }', 'parameters' ],
    [ 'undocumented constructor', 'class Service { constructor(value) {} }', 'missing' ],
    [ 'undocumented getter', 'class Service { get value() { return 1; } }', 'missing' ],
    [ 'undocumented setter', 'const service = { set value(value) {} };', 'missing' ],
    [ 'undocumented object function', 'const service = { save: function(value) {} };', 'missing' ],
    [ 'undocumented object arrow', 'const service = { save: value => value };', 'missing' ],
    [ 'undocumented class field', 'class Service { save = value => value; }', 'missing' ],
    [ 'undocumented computed method', 'class Service { [methodName](value) {} }', 'missing' ]
])('public method JSDoc rejects %s', (title, source, messageId) =>
{
    const result = checkRule('require-public-method-jsdoc', source);
    expect(result.messages.map(message => message.messageId)).toEqual([messageId]);
    expect(result.fixed).toBe(false);
    expect(result.output).toBe(source);
});
