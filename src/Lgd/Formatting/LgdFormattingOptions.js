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
        defaults: { style: 'space', size: 4, tabWidth: 4, continuation: 4, constructorInitializer: 4, tabUsage: 'always', caseLabels: true, caseContents: true, caseBlocks: true, labels: 'preserve' },
        properties: {
            style: { enum: [ 'space', 'tab' ] }, size: { type: 'integer', minimum: 1, maximum: 16 }, tabWidth: { type: 'integer', minimum: 1, maximum: 16 }, continuation: { type: 'integer', minimum: 0, maximum: 32 },
            constructorInitializer: { type: 'integer', minimum: 0, maximum: 32 }, tabUsage: { enum: [ 'indentation', 'continuation', 'always' ] },
            caseLabels: { type: 'boolean' }, caseContents: { type: 'boolean' }, caseBlocks: { type: 'boolean' }, labels: { enum: [ 'preserve', 'flushLeft', 'oneLess' ] }
        }
    },
    {
        id: 'lgd.format.spacing', title: 'Horizontal spacing',
        defaults: {
            afterControlKeywords: false, beforeFunctionParen: false, beforeMethodParen: false, beforeCallParen: false,
            afterCast: false, insideCastParens: false, insideControlParens: false, insideDeclarationParens: false, insideCallParens: false, insideOtherParens: false,
            insideEmptyDeclarationParens: false, insideEmptyCallParens: false,
            beforeInheritanceColon: true, afterInheritanceColon: true, binaryOperators: 'both', beforeAssignment: true, afterAssignment: true,
            beforeComma: false, afterComma: true, beforeDot: false, afterDot: false, beforeForSemicolon: false, afterForSemicolon: true,
            beforeSquareBracket: false, insideSquareBrackets: false, insideEmptySquareBrackets: false,
            declarations: 'normalize', insideObjectBraces: true, insideEmptyBlockBraces: true, insideEmptyObjectBraces: false
        },
        properties: {}
    },
    {
        id: 'lgd.format.lineBreaks', title: 'Block layout and blank lines',
        defaults: { shortBlocks: 'never', shortFunctions: 'empty', shortLambdas: 'never', shortIfs: 'never', shortLoops: false, shortCases: false, embeddedStatementsSameLine: true, preserveSingleLineBlocks: false, preserveSingleLineStatements: false, objectMembers: 'preserve', importGroups: 'preserve', separateDefinitions: 'preserve', blankLinesBetweenClosingBraces: false, statementImmediatelyAfterBlock: true, blankLineAfterConstructorColon: true, blankLineAfterConditionalToken: true, blankLineAfterArrow: true, maxEmptyLines: 1, emptyLinesAtBlockStart: false, emptyLinesAtBlockEnd: false },
        properties: {
            shortBlocks: { enum: [ 'preserve', 'never', 'empty', 'always' ] }, shortFunctions: { enum: [ 'preserve', 'never', 'empty', 'inline', 'all' ] }, shortLambdas: { enum: [ 'preserve', 'never', 'empty', 'inline', 'all' ] },
            shortIfs: { enum: [ 'preserve', 'never', 'withoutElse', 'all' ] }, shortLoops: { type: 'boolean' }, shortCases: { type: 'boolean' }, embeddedStatementsSameLine: { type: 'boolean' }, preserveSingleLineBlocks: { type: 'boolean' }, preserveSingleLineStatements: { type: 'boolean' },
            importGroups: { enum: [ 'preserve', 'origin', 'none' ] }, objectMembers: { enum: [ 'preserve', 'onePerLine', 'singleLine' ] }, separateDefinitions: { enum: [ 'preserve', 'always', 'never' ] }, blankLinesBetweenClosingBraces: { type: 'boolean' }, statementImmediatelyAfterBlock: { type: 'boolean' }, blankLineAfterConstructorColon: { type: 'boolean' }, blankLineAfterConditionalToken: { type: 'boolean' }, blankLineAfterArrow: { type: 'boolean' }, maxEmptyLines: { type: 'integer', minimum: 0, maximum: 10 }, emptyLinesAtBlockStart: { type: 'boolean' }, emptyLinesAtBlockEnd: { type: 'boolean' }
        }
    },
    {
        id: 'lgd.format.wrapping', title: 'Argument and expression wrapping',
        defaults: { columnLimit: 120, arguments: 'preserve', parameters: 'preserve', alignAfterOpenBracket: false, allowAllArgumentsOnNextLine: false, allowAllParametersOnNextLine: false, binaryOperators: 'preserve', binaryOperations: 'preserve', returnType: 'preserve', constructorInitializer: 'preserve' },
        properties: {
            columnLimit: { type: 'integer', minimum: 0, maximum: 1000 }, arguments: { enum: [ 'preserve', 'binPack', 'onePerLine' ] }, parameters: { enum: [ 'preserve', 'binPack', 'onePerLine' ] }, alignAfterOpenBracket: { type: 'boolean' }, allowAllArgumentsOnNextLine: { type: 'boolean' }, allowAllParametersOnNextLine: { type: 'boolean' }, binaryOperators: { enum: [ 'preserve', 'before', 'after', 'beforeNonAssignment' ] }, binaryOperations: { enum: [ 'preserve', 'respectPrecedence', 'onePerLine' ] }, returnType: { enum: [ 'preserve', 'sameLine', 'nextLine' ] }, constructorInitializer: { enum: [ 'preserve', 'beforeColon', 'afterColon' ] }
        }
    },
    {
        id: 'lgd.format.whitespace', title: 'Whitespace and line endings',
        defaults: { fileHeader: '', endOfLine: 'preserve', finalNewline: 'preserve', trimTrailingWhitespace: true },
        properties: { fileHeader: { type: 'string', maxLength: 4096 }, endOfLine: { enum: [ 'preserve', 'lf', 'crlf', 'cr' ] }, finalNewline: { enum: [ 'preserve', 'always', 'never' ] }, trimTrailingWhitespace: { type: 'boolean' } }
    },
    {
        id: 'lgd.format.bracesRequired', title: 'Control-flow braces',
        defaults: { mode: 'preserve' }, properties: { mode: { enum: [ 'preserve', 'always', 'multiLine' ] } }
    }
];

catalog.push(require('./LgdDeclarationStyleOptions'));

for(const [ key, value ] of Object.entries(catalog[2].defaults))
{
    catalog[2].properties[key] = typeof value === 'boolean' ? { type: 'boolean' } : { enum: [ 'both', 'none', 'preserve' ] };
}

catalog[2].properties.declarations = { enum: [ 'normalize', 'preserve' ] };

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

    /** @description Rejects invalid imported values before they can reach repeat counts or layout calculations. */
    validate(options)
    {
        const valid = {};
        const issues = [];
        for(const [ group, entries ] of Object.entries(options || {}))
        {
            const rule = catalog.find(candidate => candidate.id === `lgd.format.${group}`);
            if(!rule || !entries || typeof entries !== 'object' || Array.isArray(entries))
            {
                issues.push(`Unknown or invalid formatting option group ${group}.`);
                continue;
            }

            valid[group] = {};
            for(const [ option, value ] of Object.entries(entries))
            {
                if(this.validValue(value, rule.properties[option]))
                {
                    valid[group][option] = value;
                }
                else
                {
                    issues.push(`Invalid imported formatting value for ${group}.${option}.`);
                }
            }
        }

        return { options: valid, issues: issues };
    },

    /** @description Checks the small, declarative schema vocabulary used by the shared option catalog. */
    validValue(value, schema)
    {
        if(!schema)
        {
            return false;
        }

        if(schema.enum)
        {
            return schema.enum.includes(value);
        }

        if(schema.type === 'string')
        {
            return typeof value === 'string' && value.length <= schema.maxLength;
        }

        if(schema.type === 'boolean')
        {
            return typeof value === 'boolean';
        }

        if(schema.type === 'integer')
        {
            return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
        }

        return value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([ key, child ]) => this.validValue(child, schema.properties[key]));
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
