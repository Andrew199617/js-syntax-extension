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
    [ 'documentation on an earlier method', 'class Service { /** Saves a value. */ save() {} read() {} }', 'missing' ],
    [ 'private marker on an earlier method', 'class Service { /** @private */ save() {} read() {} }', 'missing' ],
    [ 'intervening comments', 'class Service { /** Saves a value. */ // Implementation note.\n save() {} }', 'missing' ],
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

test.each([
    [ 'ES module functions with imports and metadata', `import dependency from './dependency.js';
export const meta = { type: 'suggestion', docs: { description: 'Example' } };
function helper() { return dependency; }
export function read() { return helper(); }
export const write = value => value;
export default function create() { return read(); }` ],
    [ 'CommonJS functions exported together', `function read() { return 1; }
function write(value) { return value; }
module.exports = { read, write: write };` ],
    [ 'individual CommonJS function exports', `exports.read = () => 1;
module.exports.write = function write(value) { return value; };` ],
    [ 'one class with local helpers and callbacks', `class Reader {
    run(values) {
        function convert(value) { return value; }
        return values.map(value => convert(value));
    }
}
export default Reader;` ],
    [ 'one exported class expression', `export default class {
    run = () => 1;
}` ],
    [ 'one OLOO object with local helpers', `const Reader = {
    create() { return Object.create(Reader); },
    run(values) {
        function convert(value) { return value; }
        return values.map(value => convert(value));
    }
};
module.exports = Reader;` ],
    [ 'one directly exported OLOO object', `export default {
    get value() { return 1; },
    run() { return this.value; }
};` ],
    [ 'one CommonJS object with arrow callbacks', `module.exports = {
    read: () => 1,
    write: value => value
};` ],
    [ 'plain configuration beside standalone functions', `const settings = { enabled: true, nested: { limit: 1 } };
function read() { return settings.enabled; }
module.exports = read;` ],
    [ 'callback configuration beside standalone functions', `function format(value) { return String(value); }
const settings = {
    enabled: true,
    onError: error => format(error.message)
};
module.exports = { format, settings };` ],
    [ 'callback configuration beside a class', `class Reader { read() { return 1; } }
const settings = {
    transform: value => String(value),
    onError: error => error.message
};
module.exports = { Reader, settings };` ],
    [ 'imports and re-exports of existing definitions', `import Reader from './Reader.js';
export { Reader };
export function read() { return Reader.read(); }` ],
    [ 'definitions local to test callbacks', `function check(value) { return value; }
test('example', () => {
    class Reader {}
    const adapter = { read() { return check(1); } };
});` ]
])('one-module-style allows %s', (description, source) =>
{
    const result = checkRule('one-module-style', source);
    expect(result.messages).toEqual([]);
});

test.each([
    [ 'a function alongside a class', `function helper() { return 1; }
class Reader { read() { return helper(); } }`, ['mixed'] ],
    [ 'an arrow alongside a class expression', `const Reader = class { read() { return 1; } };
const helper = () => 1;`, ['mixed'] ],
    [ 'an async function alongside an OLOO object', `const Reader = {
    create() { return Object.create(Reader); },
    read() { return 1; }
};
async function helper() { return await Reader.read(); }`, ['mixed'] ],
    [ 'a function expression alongside an OLOO object', `const helper = function helper() { return 1; };
const Reader = { read: function read() { return helper(); } };`, ['mixed'] ],
    [ 'a named function export alongside a default object export', `export function helper() { return 1; }
export default { read() { return helper(); } };`, ['mixed'] ],
    [ 'a helper alongside a CommonJS object export', `function helper() { return 1; }
module.exports = { read() { return helper(); } };`, ['mixed'] ],
    [ 'CommonJS function exports alongside a class', `class Reader {}
exports.read = () => 1;
module['exports'].write = function write(value) { return value; };`, [ 'mixed', 'mixed' ] ],
    [ 'two classes', `class Reader {}
export default class Writer {}`, ['multiple'] ],
    [ 'two OLOO objects', `const Reader = { read() { return 1; } };
const Writer = { write(value) { return value; } };`, ['multiple'] ],
    [ 'a class and an OLOO object', `export class Reader {}
const Writer = { write(value) { return value; } };`, ['multiple'] ],
    [ 'multiple definitions in one declaration', `const Reader = class {}, Writer = { write() { return 1; } };`, ['multiple'] ],
    [ 'a standalone helper beside an accessor object', `function read() { return 1; }
const Reader = { get value() { return read(); } };`, ['mixed'] ]
])('one-module-style rejects %s', (description, source, expectedMessages) =>
{
    const result = checkRule('one-module-style', source);
    expect(result.messages.map(message => message.messageId)).toEqual(expectedMessages);
    expect(result.fixed).toBe(false);
    expect(result.output).toBe(source);
});
