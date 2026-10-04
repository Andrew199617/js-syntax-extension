const virtualMachine = require('vm');
const LgdExpressionStyles = require('../../../src/Lgd/Formatting/LgdExpressionStyles');
const LgdFormatter = require('../../../src/Lgd/Formatting/LgdFormatter');
const LgdExpressionStyleOptions = require('../../../src/Lgd/Formatting/LgdExpressionStyleOptions');
const LgdEditorConfig = require('../../../src/Lgd/Formatting/LgdEditorConfig');
const LgdFormattingPolicy = require('../../../src/Lgd/Fixes/LgdFormattingPolicy');
const LgdFixSettings = require('../../../src/Lgd/Fixes/LgdFixSettings');
const LgdFormattingSources = require('../../../src/Lgd/Formatting/LgdFormattingSources');
const LgdFormattingRules = require('../../../src/Lgd/Fixes/LgdFormattingRules');
const schema = require('../../../schemas/lgd.schema.json');

/** @description Applies only the requested guarded expression preference. */
function rewrite(source, option, mode = 'prefer', rules = {})
{
    return LgdFormatter.apply(source, LgdExpressionStyles.analyze(source, { options: { expressions: { [option]: mode } }, rules: rules }));
}

/** @description Runs examples in isolated contexts to compare observable values and side effects. */
function evaluate(source)
{
    return virtualMachine.runInNewContext(source);
}

/** @description Marks source interpolation without interpolating the fixture itself. */
function templateSource(source)
{
    return source.replace(/@\{/gu, '${');
}

describe('guarded expression styles', () =>
{
    test.each([
        [ 'booleanSimplification', 'function f(x){return x ? true : false;}', '!!(x)' ],
        [ 'booleanSimplification', 'function f(x){return x ? false : true;}', '!(x)' ],
        [ 'compoundAssignment', 'function f(x,y){x = x + y;}', 'x += (y)' ],
        [ 'compoundAssignment', 'function f(x,y){x = x ?? y;}', 'x ??= (y)' ],
        [ 'inferredMemberNames', 'function f(x){return {x: x};}', '{x}' ],
        [ 'conditionalReturn', 'function f(x){if(x){return 1;}else{return 2;}}', 'return (x) ? (1) : (2);' ],
        [ 'conditionalAssignment', 'function f(x,y){if(y){x=1;}else{x=2;}}', 'x = (y) ? (1) : (2);' ],
        [ 'coalesce', 'function f(x,y){return x === null || x === void 0 ? y : x;}', '(x ?? (y))' ],
        [ 'coalesce', 'function f(x,y){return x !== null && x !== void 0 ? x : y;}', '(x ?? (y))' ],
        [ 'nullPropagation', 'function f(x){return x === null || x === void 0 ? void 0 : x.y;}', '(0, x?.y)' ],
        [ 'nullPropagation', 'function f(x,y){return x === null || x === void 0 ? void 0 : x[y()];}', '(0, x?.[y()])' ],
        [ 'conditionalCall', 'function f(x){if(x !== null && x !== void 0){x(1);}}', 'x?.(1);' ],
        [ 'interpolation', templateSource('function f(){return `a@{1}b@{"c"}`;}'), '`a1bc`' ]
    ])('rewrites safe %s forms', (option, source, expected) =>
    {
        const findings = LgdExpressionStyles.analyze(source, { options: { expressions: { [option]: 'prefer' } } });
        expect(findings[0].code).toBe(`lgd.format.expressions.${option}`);
        const result = rewrite(source, option);
        expect(result).toContain(expected);
        expect(rewrite(result, option)).toBe(result);
        expect(rewrite(source, option, 'preserve')).toBe(source);
        expect(rewrite(source, option, 'prefer', { [`lgd.format.expressions.${option}`]: { severity: 'off' } })).toBe(source);
    });

    test.each([
        [ 'coalesce', 'function f(x,y){return x == null ? y : x;}' ],
        [ 'coalesce', 'function f(x,y){return x === null ? y : x;}' ],
        [ 'coalesce', 'function f(x,y){return x === undefined || x === null ? y : x;}' ],
        [ 'coalesce', 'function f(){return x === null || x === void 0 ? 1 : x;}' ],
        [ 'coalesce', 'function f(x){eval("x=1");return x === null || x === void 0 ? 1 : x;}' ],
        [ 'nullPropagation', 'function f(x){return x === null || x === void 0 ? null : x.y;}' ],
        [ 'compoundAssignment', 'function f(x,y){x.y = x.y + y;}' ],
        [ 'compoundAssignment', 'function f(x,y){x = y + x;}' ],
        [ 'compoundAssignment', 'function f(y){x = x + y;}' ],
        [ 'compoundAssignment', 'function f(){const x=1;x=x??2;}' ],
        [ 'compoundAssignment', 'function f(x){x=x??(()=>1);}' ],
        [ 'conditionalAssignment', 'function f(x,y){if(y){x=()=>1;}else{x=()=>2;}}' ],
        [ 'inferredMemberNames', 'function f(__proto__){return {__proto__: __proto__};}' ],
        [ 'inferredMemberNames', 'function f(x){const {x: x}=item;}' ],
        [ 'conditionalReturn', 'function f(x){if(x){let y=1;return y;}else{return 2;}}' ],
        [ 'conditionalAssignment', 'function f(x,y){if(y){x.value=1;}else{x.value=2;}}' ],
        [ 'conditionalCall', 'function f(x){if(x !== null) x();}' ],
        [ 'interpolation', templateSource('function f(tag){return tag`a@{1}`;}') ],
        [ 'booleanSimplification', 'function f(x){return x ? 1 : 0;}' ],
        [ 'interpolation', templateSource('function f(){return `@{/* keep */1}`;}') ],
        [ 'booleanSimplification', 'function f(x){return x ? /* keep */ true : false;}' ],
        [ 'booleanSimplification', 'function f(x){/* lgd-format off */return x ? true : false;}' ]
    ])('declines unsafe or inapplicable %s forms', (option, source) =>
    {
        expect(rewrite(source, option)).toBe(source);
    });

    test('parentheses removal preserves grouping, directives and optional chaining', () =>
    {
        expect(rewrite('function f(a,b){return (a+b);}', 'parenthesesArithmetic', 'never_if_unnecessary')).toBe('function f(a,b){return a+b;}');
        for(const source of [ 'function f(a,b,c){return (a+b)*c;}', 'function f(a){return (a?.b).c;}', 'function f(){("use strict");return this;}' ])
        {
            expect(rewrite(source, 'parenthesesOther', 'never_if_unnecessary')).toBe(source);
            expect(rewrite(source, 'parenthesesArithmetic', 'never_if_unnecessary')).toBe(source);
        }
    });

    test('clarity groups mixed operators without changing their meaning', () =>
    {
        const source = 'function f(a,b,c){return a+b*c;}';
        expect(rewrite(source, 'parenthesesArithmetic', 'always_for_clarity')).toBe('function f(a,b,c){return a+(b*c);}');
    });

    test.each([
        [ 'booleanSimplification', 'function f(x){return x?true:false;} [null,void 0,0,1,"",{},[]].map(f)' ],
        [ 'coalesce', 'function f(x){return x===null||x===void 0?"fallback":x;} [null,void 0,0,false,""].map(f)' ],
        [ 'compoundAssignment', 'function f(x){x=x+(x=7);return x;} f(3)' ],
        [ 'nullPropagation', 'function f(x){return (x===null||x===void 0?void 0:x.method)();} f({method:function(){"use strict";return this;}})' ],
        [ 'nullPropagation', 'let hits=0; function f(x){return x===null||x===void 0?void 0:x[++hits];} [f(null),f({1:42}),hits]' ],
        [ 'conditionalReturn', 'let hits=0;function f(x){if(++hits&&x){return ++hits;}else{return --hits;}} [f(true),hits]' ],
        [ 'conditionalAssignment', 'function f(x){if(x=3){x=x+1;}else{x=x-1;}return x;} f(0)' ],
        [ 'interpolation', templateSource('function f(){return `$@{"{"}notAnExpression} @{"`"} @{"\\\\"}`;} f()') ]
    ])('%s preserves runtime values and evaluation count', (option, source) =>
    {
        const result = rewrite(source, option);
        expect(result).not.toBe(source);
        expect(evaluate(result)).toEqual(evaluate(source));
    });
});

describe('expression configuration integration', () =>
{
    test('catalog, strict settings and native schema expose the same family and option policies', () =>
    {
        const catalog = LgdExpressionStyleOptions.catalog;
        const properties = schema.properties.formatting.properties.options.properties.expressions.properties;
        expect(properties).toEqual(catalog.properties);
        const settings = LgdFixSettings.create(LgdFormattingPolicy.rules().map(rule => rule.id));
        for(const option of Object.keys(properties))
        {
            const ruleId = `${catalog.id}.${option}`;
            expect(schema.definitions.rules.properties[ruleId]).toBeDefined();
            expect(LgdFormattingPolicy.definition(ruleId)).toBeDefined();
            for(const mode of properties[option].enum)
            {
                const config = { version: 1, formatting: { enabled: true, options: { expressions: { [option]: mode } } }, rules: { [ruleId]: { fix: 'manual', severity: 'warning' } } };
                expect(settings.parse(JSON.stringify(config))).toEqual(config);
            }
        }

        expect(() => settings.parse(JSON.stringify({ version: 1, formatting: { options: { expressions: { coalesce: 'unsafe' } } } }))).toThrow();
    });

    test('every imported expression preference preserves valid modes and rejects unsupported values', () =>
    {
        for(const [ key, option ] of Object.entries(LgdExpressionStyleOptions.editorConfig))
        {
            let modes = option.startsWith('parentheses') ? LgdExpressionStyleOptions.catalog.properties[option].enum : [ 'true', 'false' ];
            if(option === 'lambdaBodies')
            {
                modes = [ 'true', 'false', 'when_on_single_line' ];
            }

            for(const mode of modes)
            {
                const mapped = LgdEditorConfig.map({ [key]: `${mode}:warning` });
                let expected = mode;
                if(mode === 'true' || mode === 'false')
                {
                    expected = mode === 'true' ? 'prefer' : 'preserve';
                    if(option === 'lambdaBodies')
                    {
                        expected = mode === 'true' ? 'always' : 'never';
                    }
                }

                expect(mapped.options.expressions[option]).toBe(expected);
                expect(mapped.rules[`lgd.format.expressions.${option}`]).toEqual({ severity: 'warning' });
                expect(mapped.issues).toEqual([]);
            }

            const invalid = LgdEditorConfig.map({ [key]: 'invalid' });
            expect(invalid.options).toEqual({});
            expect(invalid.issues).toHaveLength(1);
        }
    });

    test('matching EditorConfig imports reach guarded diagnostic findings without authorizing automatic fixes', async () =>
    {
        const configuration = '[*.lgd]\ndotnet_style_coalesce_expression = true:error\n[*.js]\ndotnet_style_coalesce_expression = false';
        function readSnapshot(filename)
        {
            return Promise.resolve({ path: filename, realPath: filename, text: filename === '/project/.editorconfig' ? configuration : null, version: null, open: false });
        }

        const imported = await LgdFormattingSources.resolve({ filePath: '/project/example.lgd', workspaceRoot: '/project', readSnapshot: readSnapshot, sources: ['editorconfig'] });
        expect(imported.issues).toEqual([]);
        expect(imported.options.expressions.coalesce).toBe('prefer');
        expect(imported.rules['lgd.format.expressions.coalesce']).toEqual({ severity: 'error' });
        const settings = { valid: true, ignored: false, formatting: { enabled: true, options: imported.options }, rules: imported.rules };
        const source = 'function choose(value, fallback) { return value === null || value === void 0 ? fallback : value; }';
        const findings = LgdFormattingRules.analyze(source, settings).filter(error => error.ruleId.startsWith('lgd.format.expressions.'));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ code: 'lgd.format.expressions.coalesce', severity: 'error', quickFix: { kind: 'format:lgd.format.expressions.coalesce' } });
        expect(LgdFormattingRules.analyze(source, { ...settings, ignored: true })).toEqual([]);
        expect(LgdFormattingRules.analyze(source, { ...settings, valid: false })).toEqual([]);
        expect(LgdFormattingRules.analyze(source, { ...settings, formatting: { enabled: false } })).toEqual([]);
    });
});
