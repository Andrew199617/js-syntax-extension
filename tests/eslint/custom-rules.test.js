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
        linter.defineRule(ruleName, rule);
        linter.defineParser('espree', require('espree'));
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

test.each([ `(values)`, `((values))`, `(values.filter(Boolean))` ])('checks parenthesized chain links: %s', receiver =>
{
    const source = `${receiver}
    .map(convert).filter(Boolean);`.replace(/\n/gu, '\r\n');
    const result = checkRule('consistent-chained-call-newline', source);
    expect(result.fixed).toBe(true);
    const expected = `${receiver}
    .map(convert)
    .filter(Boolean);`.replace(/\n/gu, '\r\n');
    expect(result.output).toBe(expected);
    expect(result.messages).toEqual([]);
});

test('multiline callback bodies do not force inline chain links apart', () =>
{
    const source = `values.map(value => {
    return value;
}).filter(Boolean);`.replace(/\n/gu, '\r\n');
    const result = checkRule('consistent-chained-call-newline', source);
    expect(result.fixed).toBe(false);
    expect(result.output).toBe(source);
    expect(result.messages).toEqual([]);
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
    [ 'one CommonJS object with arrow methods', `module.exports = {
    read: () => 1,
    write: value => value
};` ],
    [ 'plain configuration beside standalone functions', `const settings = { enabled: true, nested: { limit: 1 } };
function read() { return settings.enabled; }
module.exports = read;` ],
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
