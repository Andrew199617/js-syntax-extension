/** @description Supported brace locations correspond to syntax that LGD can actually represent. */
const braceLocations = [ 'classes', 'interfaces', 'enums', 'constructors', 'methods', 'accessors', 'functions', 'lambdas', 'controlBlocks', 'switchBlocks', 'caseBlocks', 'tryBlocks', 'elseBlocks', 'catchBlocks', 'finallyBlocks', 'objectLiterals', 'objectPatterns' ];

/** @description Each rule owns its style options independently of diagnostic severity and automatic application. */
const catalog = [
    {
        id: 'lgd.format.braces', title: 'Brace placement',
        defaults: { style: 'allman', wrapping: {}, beforeElse: true, beforeCatch: true, beforeFinally: true, beforeWhile: false },
        properties: {
            style: { enum: [ 'attach', 'allman', 'stroustrup', 'linux', 'mozilla', 'webkit', 'gnu', 'whitesmiths', 'custom' ] },
            wrapping: { type: 'object', additionalProperties: false, properties: Object.fromEntries(braceLocations.map(location => [ location, { enum: [ 'inherit', 'sameLine', 'nextLine', 'nextLineIndented', 'nextLineIfMultiline' ] } ])) },
            beforeElse: { type: 'boolean' }, beforeCatch: { type: 'boolean' }, beforeFinally: { type: 'boolean' }, beforeWhile: { type: 'boolean' }
        }
    },
    {
        id: 'lgd.format.indentation', title: 'Indentation',
        defaults: { style: 'space', size: 4, tabWidth: 4, continuation: 4, caseLabels: true, caseContents: true, caseBlocks: true, labels: 'preserve' },
        properties: {
            style: { enum: [ 'space', 'tab' ] }, size: { type: 'integer', minimum: 1, maximum: 16 }, tabWidth: { type: 'integer', minimum: 1, maximum: 16 }, continuation: { type: 'integer', minimum: 0, maximum: 32 },
            caseLabels: { type: 'boolean' }, caseContents: { type: 'boolean' }, caseBlocks: { type: 'boolean' }, labels: { enum: [ 'preserve', 'flushLeft', 'oneLess' ] }
        }
    },
    {
        id: 'lgd.format.spacing', title: 'Horizontal spacing',
        defaults: {
            afterControlKeywords: false, beforeFunctionParen: false, beforeMethodParen: false, beforeCallParen: false,
            insideControlParens: false, insideDeclarationParens: false, insideCallParens: false, insideOtherParens: false,
            insideEmptyDeclarationParens: false, insideEmptyCallParens: false,
            beforeInheritanceColon: true, afterInheritanceColon: true, binaryOperators: 'both', beforeAssignment: true, afterAssignment: true,
            beforeComma: false, afterComma: true, beforeDot: false, afterDot: false, beforeForSemicolon: false, afterForSemicolon: true,
            beforeSquareBracket: false, insideSquareBrackets: false, insideEmptySquareBrackets: false,
            insideObjectBraces: true, insideEmptyBlockBraces: true, insideEmptyObjectBraces: false
        },
        properties: {}
    },
    {
        id: 'lgd.format.lineBreaks', title: 'Block layout and blank lines',
        defaults: { shortBlocks: 'never', shortFunctions: 'empty', shortLambdas: 'never', shortIfs: 'never', shortLoops: false, shortCases: false, objectMembers: 'preserve', separateDefinitions: 'preserve', maxEmptyLines: 1, emptyLinesAtBlockStart: false, emptyLinesAtBlockEnd: false },
        properties: {
            shortBlocks: { enum: [ 'preserve', 'never', 'empty', 'always' ] }, shortFunctions: { enum: [ 'preserve', 'never', 'empty', 'inline', 'all' ] }, shortLambdas: { enum: [ 'preserve', 'never', 'empty', 'inline', 'all' ] },
            shortIfs: { enum: [ 'preserve', 'never', 'withoutElse', 'all' ] }, shortLoops: { type: 'boolean' }, shortCases: { type: 'boolean' },
            objectMembers: { enum: [ 'preserve', 'onePerLine', 'singleLine' ] }, separateDefinitions: { enum: [ 'preserve', 'always', 'never' ] }, maxEmptyLines: { type: 'integer', minimum: 0, maximum: 10 }, emptyLinesAtBlockStart: { type: 'boolean' }, emptyLinesAtBlockEnd: { type: 'boolean' }
        }
    },
    {
        id: 'lgd.format.wrapping', title: 'Argument and expression wrapping',
        defaults: { columnLimit: 120, arguments: 'preserve', parameters: 'preserve', alignAfterOpenBracket: false, allowAllArgumentsOnNextLine: false, allowAllParametersOnNextLine: false, binaryOperators: 'preserve', constructorInitializer: 'preserve' },
        properties: {
            columnLimit: { type: 'integer', minimum: 0, maximum: 1000 }, arguments: { enum: [ 'preserve', 'binPack', 'onePerLine' ] }, parameters: { enum: [ 'preserve', 'binPack', 'onePerLine' ] }, alignAfterOpenBracket: { type: 'boolean' }, allowAllArgumentsOnNextLine: { type: 'boolean' }, allowAllParametersOnNextLine: { type: 'boolean' }, binaryOperators: { enum: [ 'preserve', 'before', 'after', 'beforeNonAssignment' ] }, constructorInitializer: { enum: [ 'preserve', 'beforeColon', 'afterColon' ] }
        }
    },
    {
        id: 'lgd.format.whitespace', title: 'Whitespace and line endings',
        defaults: { endOfLine: 'preserve', finalNewline: 'preserve', trimTrailingWhitespace: true },
        properties: { endOfLine: { enum: [ 'preserve', 'lf', 'crlf', 'cr' ] }, finalNewline: { enum: [ 'preserve', 'always', 'never' ] }, trimTrailingWhitespace: { type: 'boolean' } }
    },
    {
        id: 'lgd.format.bracesRequired', title: 'Control-flow braces',
        defaults: { mode: 'preserve' }, properties: { mode: { enum: [ 'preserve', 'always', 'multiLine' ] } }
    }
];

for(const [ key, value ] of Object.entries(catalog[2].defaults))
{
    catalog[2].properties[key] = typeof value === 'boolean' ? { type: 'boolean' } : { enum: [ 'both', 'none', 'preserve' ] };
}

/** @description Supplies the single option catalog used by config validation, adapters and formatting. */
const LgdFormattingOptions = {
    catalog: catalog,
    optionRules: catalog.flatMap(rule =>
    {
        const options = Object.keys(rule.properties).filter(option => rule.id !== 'lgd.format.braces' || ![ 'style', 'wrapping' ].includes(option));
        if(rule.id === 'lgd.format.braces')
        {
            options.push(...braceLocations);
        }

        return options.map(option => ({ id: `${rule.id}.${option}`, parentRuleId: rule.id, title: `${rule.title}: ${option}` }));
    }),
    braceLocations: braceLocations,

    /** @description Returns fresh options so one document cannot mutate another document's settings. */
    defaults()
    {
        return Object.fromEntries(catalog.map(rule => [ rule.id.slice('lgd.format.'.length), JSON.parse(JSON.stringify(rule.defaults)) ]));
    },

    /** @description Overlays only explicitly configured values, retaining independently specified brace locations. */
    merge(base, additional)
    {
        const merged = JSON.parse(JSON.stringify(base));
        for(const [ group, values ] of Object.entries(additional || {}))
        {
            if(!values || typeof values !== 'object' || Array.isArray(values))
            {
                continue;
            }

            merged[group] = { ...merged[group], ...values };
            if(group === 'braces' && values.wrapping)
            {
                merged.braces.wrapping = { ...base.braces?.wrapping, ...values.wrapping };
            }
        }

        return merged;
    },

    /** @description Applies native per-rule options after imported and document formatting settings. */
    resolve(configuration = {})
    {
        let options = this.merge(this.defaults(), configuration.options);
        for(const rule of catalog)
        {
            const configured = configuration.rules?.[rule.id];
            if(configured?.options)
            {
                options = this.merge(options, { [rule.id.slice('lgd.format.'.length)]: configured.options });
            }
        }

        return options;
    }
};

module.exports = LgdFormattingOptions;
