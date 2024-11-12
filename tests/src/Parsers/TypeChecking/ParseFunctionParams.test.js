const ParseFunctionParams = require('../../../../src/Parsers/TypeChecking/ParseFunctionParams');

describe('ParseFunctionParams', () => {
  let parseFunctionParams;

  beforeEach(() => {
    parseFunctionParams = ParseFunctionParams.create();
  });

  test('should return undefined variables correctly', () => {
    const code = `
      const a = 1;
      const b = 2;
      console.log(a + b);
      console.log(c);
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('c');
    expect(undefinedVars).not.toContain('a');
    expect(undefinedVars).not.toContain('b');
    expect(undefinedVars).toHaveLength(1);
  });

  test('should return an empty array when no undefined variables', () => {
    const code = `
      const a = 1;
      const b = 2;
      console.log(a + b);
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toEqual([]);
  });

  test('should handle functions with parameters', () => {
    const code = `
      function test(d) {
        console.log(d + e);
      }
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('e');
    expect(undefinedVars).not.toContain('d');
    expect(undefinedVars).toHaveLength(1);
  });

  test('should handle deeply nested functions up to four levels', () => {
    const code = `
      function level1(x) {
        function level2(y) {
          if (y > 0) {
            function level3(z) {
              while (z > 0) {
                function level4(w) {
                  console.log(w + v);
                }
                level4(z);
              }
            }
            level3(y);
          }
        }
        level2(x);
      }
      level1(a);
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('v');
    expect(undefinedVars).toContain('a');
    expect(undefinedVars).not.toContain('x');
    expect(undefinedVars).not.toContain('y');
    expect(undefinedVars).not.toContain('z');
    expect(undefinedVars).not.toContain('w');
    expect(undefinedVars).toHaveLength(2);
  });

  test('should handle for loops with declared variables', () => {
    const code = `
      const items = [1, 2, 3];
      for (let i = 0; i < items.length; i++) {
        console.log(items[i] + j);
      }
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('j');
    expect(undefinedVars).not.toContain('items');
    expect(undefinedVars).not.toContain('i');
    expect(undefinedVars).toHaveLength(1);
  });

  test('should handle while loops with declared variables', () => {
    const code = `
      let count = 10;
      while (count > 0) {
        console.log(count + k);
        count--;
      }
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('k');
    expect(undefinedVars).not.toContain('count');
  });

  test('should handle combined nested structures with loops', () => {
    const code = `
      function outer(a) {
        for (let i = 0; i < a.length; i++) {
          function inner(b) {
            if (b > 0) {
              while (b > 0) {
                console.log(a[i] + m);
                b--;
              }
            }
          }
          inner(a[i]);
        }
        console.log(n);
      }
      outer(arr);
    `;
    const undefinedVars = parseFunctionParams.getUndefinedVariables(code);
    expect(undefinedVars).toContain('m');
    expect(undefinedVars).toContain('n');
    expect(undefinedVars).toContain('arr');
    expect(undefinedVars).not.toContain('a');
    expect(undefinedVars).not.toContain('i');
    expect(undefinedVars).not.toContain('b');
    expect(undefinedVars).toHaveLength(3);
  });
});