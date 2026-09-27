const InvertIf = require('../../../src/Refactor/InvertIf');
const parser = require('@babel/parser');
const virtualMachine = require('vm');

function plan(source, marker = 'if', settings = {})
{
    const start = source.indexOf(marker);
    return InvertIf.createEdit(source, { start: start, end: start }, settings);
}

function invert(source, marker = 'if', settings = {})
{
    const edit = plan(source, marker, settings);
    expect(edit).not.toBeNull();
    const result = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return result;
}

function executeSource(source, call)
{
    const context = { output: [] };
    virtualMachine.runInNewContext(`${source}
result = ${call};`, context);
    return { returnValue: context.result, output: context.output };
}

function expectSameBehavior(originalSource, invertedSource, calls)
{
    for(const call of calls)
    {
        const originalExecution = executeSource(originalSource, call);
        const invertedExecution = executeSource(invertedSource, call);
        expect(invertedExecution).toEqual(originalExecution);
    }
}

function createThreeArgumentCalls(argumentExpressions)
{
    const calls = [];
    for(const ready of argumentExpressions)
    {
        for(const other of argumentExpressions)
        {
            for(const third of argumentExpressions)
            {
                calls.push(`run(${ready}, ${other}, ${third})`);
            }
        }
    }

    return calls;
}

test('flattens a tail conditional and keeps two-space indentation', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push(1);
    output.push(2);
  }
}`;
    const expected = `function run(ready) {
  if (!ready) {
    return;
  }

  output.push(1);
  output.push(2);
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toBe(expected);
});

test.each([
    [ `!ready`, `ready` ],
    [ `!(ready)`, `(ready)` ],
    [ `!!ready`, `!ready` ],
    [ `ready === other`, `ready !== other` ],
    [ `ready !== other`, `ready === other` ],
    [ `ready == other`, `ready != other` ],
    [ `ready != other`, `ready == other` ],
    [ `ready && other`, `!ready || !other` ],
    [ `ready || other`, `!ready && !other` ],
    [ `ready < other`, `!(ready < other)` ],
    [ `ready <= other`, `!(ready <= other)` ],
    [ `ready > other`, `!(ready > other)` ],
    [ `ready >= other`, `!(ready >= other)` ],
    [ `ready ?? other`, `!(ready ?? other)` ]
])('negates %s without changing truthiness', (condition, negation) =>
{
    const originalSource = `function run(ready, other) {
  if (${condition}) {
    output.push('yes');
  }
}`;
    const argumentExpressions = [ `true`, `false`, `null`, `undefined`, `0`, `1`, `''`, `'value'`, `NaN` ];
    const calls = argumentExpressions.flatMap(ready => argumentExpressions.map(other => `run(${ready}, ${other})`));
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, calls);
    expect(invertedSource).toContain(`if (${negation})`);
});

test.each([
    `ready && other || third`,
    `ready || other && third`,
    `(ready || other) && third`,
    `!(ready && other) || third`,
    `(ready && (other || third))`,
    `ready /* && comment */ && other`,
    `ready /* === comment */ === other`,
    `ready /*&&*/ && other`,
    `ready /*===*/ === other`
])('preserves precedence and comments in %s', condition =>
{
    const originalSource = `function run(ready, other, third) {
  if (${condition}) {
    output.push('yes');
  }
}`;
    const argumentExpressions = [ `true`, `false`, `null`, `'value'` ];
    const calls = createThreeArgumentCalls(argumentExpressions);
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, calls);
});

test('keeps short-circuit evaluation order and side effects', () =>
{
    const originalSource = `function run(ready, other) {
  function check(value) {
    output.push(value);
    return value;
  }

  if (check(ready) && check(other)) {
    output.push("yes");
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true, true)`, `run(true, false)`, `run(false, true)` ]);
});

test('preserves parentheses and comments around an equality operator', () =>
{
    const originalSource = `function run(ready, other) {
  if ((ready) /* before */ === /* after */ (other)) {
    output.push("equal");
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(1, 1)`, `run(1, 2)`, `run(NaN, NaN)` ]);
    expect(invertedSource).toContain(`(ready) /* before */ !== /* after */ (other)`);
});

test('handles multiline headers, braces in literals, and the final line', () =>
{
    const originalSource = `function run(ready) {
  if (
    ready && /[{}]/.test("}")
  ) {
    // } is a comment
    output.push({ value: "{" });
  }}`;
    const invertedSource = invert(originalSource, `ready &&`);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toContain(`// } is a comment`);
});

test('preserves tabs, CRLF, and multiline template values', () =>
{
    const originalSource = `function run(ready) {
	if (ready) {
		output.push(\`first
		  second
		third\`);
	}
}`.replace(/\n/gu, '\r\n');
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toContain(`\r\n\t\treturn;`);
    expect(invertedSource).toContain(`\r\n\toutput.push`);
    expect(invertedSource.replace(/\r\n/gu, '')).not.toContain('\n');
});

test('uses continue for each iteration and still runs code after the loop', () =>
{
    const originalSource = `function run(items) {
  for (const item of items) {
    if (item) {
      output.push(item);
    }
  }

  output.push("done");
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run([0, 1, 2])`, `run([])` ]);
    expect(invertedSource).toContain(`continue;`);
    expect(invertedSource).not.toContain(`return;`);
});

test('wraps unbraced loop bodies before lifting statements', () =>
{
    const originalSource = `function run(items) {
  for (const item of items)
    if (item)
      output.push(item);

  output.push("done");
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [`run([0, 1, 2])`]);
});

test('infers two-space indentation from an unbraced body', () =>
{
    const originalSource = `function run(ready) {
  if (ready)
    output.push("ready");
}`;
    const expected = `function run(ready) {
  if (!ready)
  {
    return;
  }

  output.push("ready");
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toBe(expected);
});

test('wraps a nested unbraced if without changing its enclosing else', () =>
{
    const originalSource = `function run(outer, inner) {
  if (outer)
    if (inner)
      output.push(1);
    else
      output.push(2);
}`;
    const invertedSource = invert(originalSource, `if (inner)`);
    expectSameBehavior(originalSource, invertedSource, [ `run(true, true)`, `run(true, false)`, `run(false, true)` ]);
});

test('reuses the following return value and preserves its comments and side effects', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push("work");
  }

  // Report completion for either branch.
  /* Keep the explanation next to the original return. */
  return output.push("done");
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toContain(`// Report completion for either branch.`);
    expect(invertedSource).toContain(`/* Keep the explanation next to the original return. */`);
});

test('moves a returning else into the guard without skipping later work', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push("work");
  } else {
    return "missing";
  }

  output.push("done");
  return "ready";
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).not.toContain('else');
    expect(invertedSource).not.toContain(`return;`);
});

test('retains else comments and preserves the scope of a copied exit', () =>
{
    const originalSource = `function run(ready) {
  const value = "outer";
  if (ready) {
    output.push(value);
  } /* failure */ else /* fallback */ {
    const value = "inner";
    output.push(value);
  }

  return value;
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource).toContain(`/* failure */`);
    expect(invertedSource).toContain(`/* fallback */`);
});

test('handles an else-if chain whose branches both terminate', () =>
{
    const originalSource = `function run(ready, other) {
  if (ready) {
    output.push(1);
  } else if (other) {
    return 2;
  } else {
    return 3;
  }

  output.push(4);
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true, true)`, `run(false, true)`, `run(false, false)` ]);
});

test.each([
    `let value = "inner";`,
    `class value {}`,
    `function value() {}`
])('keeps an else binding separate from the following return: %s', declaration =>
{
    const originalSource = `function run(ready) {
  const value = "outer";
  if (ready) {
    output.push(value);
  } else {
    ${declaration}
    output.push(typeof value);
  }

  return value;
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
});

test('allows repeated inversion to flatten a nested tree', () =>
{
    const originalSource = `function run(outer, inner) {
  if (outer) {
    if (inner) {
      output.push(1);
    }
  }
}`;
    const outerInvertedSource = invert(originalSource, `if (outer)`);
    const invertedSource = invert(outerInvertedSource, `if (inner)`);
    expect(invertedSource)
        .toContain(`
  output.push(1);`);

    expectSameBehavior(originalSource, invertedSource, [ `run(true, true)`, `run(true, false)`, `run(false, true)` ]);
});

test.each([
    `function run(ready) {
  const value = "outer";
  if (ready) {
    const value = "inner";
    output.push(value);
  }
}`,
    `function run(ready) {
  output.push(typeof value);
  if (ready) {
    let value = 1;
    output.push(value);
  }
}`,
    `function run(ready) {
  const read = () => typeof value;
  if (ready) {
    let value = 1;
    output.push(read());
  }
}`,
    `function run(ready) {
  if (ready) {
    const value = 1;
    output.push(value);
  } else {
    return typeof value;
  }
}`,
    `function run(ready) {
  if (ready) {
    function read() {
      return 1;
    }

    output.push(read());
  }
}`
])('preserves block bindings: %s', originalSource =>
{
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
});

test('lifts local declarations when their scope cannot affect other code', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    const value = 1;
    output.push(value);
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource)
        .toContain(`
  const value = 1;`);
});

test('keeps trailing line comments separate from a same-line closing brace', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push(1); // keep this
  }}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource)
        .toContain(`// keep this
`);
});

test('preserves Allman braces and four-space indentation', () =>
{
    const originalSource = `function run(ready)
{
    if(ready)
    {
        output.push(1);
    }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource)
        .toContain(`    if(!ready)
    {
        return;
    }`);

    expect(invertedSource)
        .toContain(`
    output.push(1);`);
});

test('uses an immediate break in a switch without changing fallthrough', () =>
{
    const originalSource = `function run(ready) {
  switch (ready) {
    case 1:
      if (ready) {
        output.push(1);
      }

      break;
    default:
      output.push(2);
  }

  output.push(3);
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(1)`, `run(0)` ]);
    expect(invertedSource).toContain(`break;`);
});

test('retains catch and finally behavior when the else branch throws', () =>
{
    const originalSource = `function run(ready) {
  try {
    if (ready) {
      output.push(1);
    } else {
      throw new Error("missing");
    }

    output.push(2);
  } catch (error) {
    output.push(error.message);
  } finally {
    output.push(3);
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
});

test('returns from a callback nested in a loop', () =>
{
    const originalSource = `function run(items) {
  for (const item of items) {
    [item].forEach(value => {
      if (value) {
        output.push(value);
      }
    });

    output.push("iteration");
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [`run([0, 1])`]);
    expect(invertedSource).toContain(`return;`);
    expect(invertedSource).not.toContain(`continue;`);
});

test('preserves continued string literals and literal whitespace', () =>
{
    const originalSource = String.raw`function run(ready) {
  if (ready) {
    output.push("first\
    second");
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
});

test('does not add a redundant block around a simple else body', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push(1);
  } else {
    output.push(2);
  }
}`;
    const invertedSource = invert(originalSource);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
    expect(invertedSource)
        .toContain(`if (!ready) {
    output.push(2);
    return;
  }`);
});

test.each([
    `function run(ready) {
  if (ready) {
    output.push(1);
  }

  output.push(2);
}`,
    `function run(ready) {
  while (ready) {
    if (ready)
      output.push(1);

    output.push(2);
  }
}`,
    `if (ready) {
  output.push(1);
}`,
    `function run(ready) {
  try {
    if (ready)
      output.push(1);
  } finally {
    output.push(2);
  }
}`,
    `function run(ready) {
  switch (ready) {
    case 1:
      if (ready)
        output.push(1);
    case 2:
      output.push(2);
  }
}`,
    `function run(ready) {
  const value = "outer";
  {
    const value = "inner";
    if (ready)
      output.push(value);
  }

  return value;
}`,
    `function run(ready) {
  output.push(typeof read);
  if (ready)
    function read() {}
}`,
    `function run() {
  const message = "if (ready) {";
}`,
    `function run() {
  // if (ready) {
}`,
    `function run(ready) {
  if (ready) {`
])('does not offer an unsafe or invalid conversion: %s', originalSource =>
{
    expect(plan(originalSource)).toBeNull();
});

test('supports TypeScript assertions and generic arrows without enabling JSX', () =>
{
    const originalSource = `const run = <Value>(ready: Value) => {
  if (<boolean>ready) {
    consume(ready);
  }
};`;
    const invertedSource = invert(originalSource, 'if', { languageId: 'typescript' });
    expect(invertedSource).toContain(`!(<boolean>ready)`);
});

test.each([
    `type Value = number;`,
    `interface Value { count: number; }`,
    `enum Value { ready }`
])('retains the scope of a TypeScript declaration: %s', declaration =>
{
    const originalSource = `type Value = string;
function run(ready: boolean) {
  const read = (value: Value) => value;
  if (ready) {
    ${declaration}
    consume(read("ready"));
  }
}`;
    const invertedSource = invert(originalSource, 'if', { languageId: 'typescript' });
    const syntax = parser.parse(invertedSource, { plugins: ['typescript'] });
    const body = syntax.program.body[1].body.body;
    expect(body.map(statement => statement.type)).toEqual([ 'VariableDeclaration', 'IfStatement', 'BlockStatement' ]);
    expect(invertedSource).toContain(declaration);
});

test.each([
    [ `type Value = string;`, `type Value = number;` ],
    [ `interface Value { outer: string; }`, `interface Value { inner: number; }` ],
    [ `enum Value { outer }`, `enum Value { inner }` ]
])('keeps a TypeScript declaration separate from the destination declaration: %s', (outerDeclaration, innerDeclaration) =>
{
    const originalSource = `function run(ready: boolean) {
  ${outerDeclaration}
  if (ready) {
    ${innerDeclaration}
    consume(1);
  }
}`;
    const invertedSource = invert(originalSource, 'if', { languageId: 'typescript' });
    const syntax = parser.parse(invertedSource, { plugins: ['typescript'] });
    const body = syntax.program.body[0].body.body;
    expect(body.slice(1).map(statement => statement.type)).toEqual([ 'IfStatement', 'BlockStatement' ]);
    expect(invertedSource).toContain(outerDeclaration);
    expect(invertedSource).toContain(innerDeclaration);
});

test('accepts the opening brace and whole-line selections through enclosing braces', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push(1);
  }
}`;
    const brace = originalSource.indexOf('{', originalSource.indexOf('if'));
    expect(InvertIf.createEdit(originalSource, { start: brace, end: brace })).not.toBeNull();
    const start = originalSource.indexOf('  if');
    const end = originalSource.lastIndexOf('}');
    expect(InvertIf.createEdit(originalSource, { start: start, end: end })).not.toBeNull();
    const edit = InvertIf.createEdit(originalSource, { start: start, end: originalSource.length });
    expect(edit).not.toBeNull();
    const invertedSource = originalSource.slice(0, edit.start) + edit.text + originalSource.slice(edit.end);
    expectSameBehavior(originalSource, invertedSource, [ `run(true)`, `run(false)` ]);
});

test('rejects a selection that also includes a following statement', () =>
{
    const originalSource = `function run(ready) {
  if (ready) {
    output.push(1);
  }
  return 2;
}`;
    const start = originalSource.indexOf('if');
    expect(plan(originalSource)).not.toBeNull();
    expect(InvertIf.createEdit(originalSource, { start: start, end: originalSource.length })).toBeNull();
});

test('preserves JSX text and supports TSX', () =>
{
    const originalSource = `function run(ready: boolean) {
  if (ready) {
    return <div>first
      second
    </div>;
  }
}`;
    const invertedSource = invert(originalSource, 'if', { languageId: 'typescriptreact' });
    const options = { plugins: [ 'typescript', 'jsx' ] };
    const before = parser.parse(originalSource, options).program.body[0].body.body[0].consequent.body[0].argument.children;
    const after = parser.parse(invertedSource, options).program.body[0].body.body[1].argument.children;
    expect(after.map(child => child.value)).toEqual(before.map(child => child.value));
});
