const yaml = require('js-yaml');

/** @description Bounds input and YAML parser work before options reach the formatter. */
const limits = { bytes: 262144, depth: 20, nodes: 10000 };

/** @description Simple scalar translations share a declarative table rather than parallel parsing engines. */
const scalarMappings = {
    ConstructorInitializerIndentWidth: [ 'indentation', 'constructorInitializer' ],
    ColumnLimit: [ 'wrapping', 'columnLimit' ], TabWidth: [ 'indentation', 'tabWidth' ], IndentWidth: [ 'indentation', 'size' ], ContinuationIndentWidth: [ 'indentation', 'continuation' ],
    IndentCaseLabels: [ 'indentation', 'caseLabels' ], AllowShortLoopsOnASingleLine: [ 'lineBreaks', 'shortLoops' ], AllowShortCaseLabelsOnASingleLine: [ 'lineBreaks', 'shortCases' ],
    SpaceBeforeAssignmentOperators: [ 'spacing', 'beforeAssignment' ], AllowAllArgumentsOnNextLine: [ 'wrapping', 'allowAllArgumentsOnNextLine' ], AllowAllParametersOfDeclarationOnNextLine: [ 'wrapping', 'allowAllParametersOnNextLine' ],
    MaxEmptyLinesToKeep: [ 'lineBreaks', 'maxEmptyLines' ], KeepEmptyLinesAtTheStartOfBlocks: [ 'lineBreaks', 'emptyLinesAtBlockStart' ]
};

/** @description LGD has no corresponding syntax for these otherwise valid clang-format options. */
const inapplicable = new Set([ 'NamespaceIndentation', 'AccessModifierOffset', 'IndentPPDirectives', 'DerivePointerAlignment', 'PointerAlignment', 'ReferenceAlignment', 'PackConstructorInitializers', 'WrapNamespaceBodyWithEmptyLines', 'FixNamespaceComments', 'SortUsingDeclarations' ]);

/** @description Presets project only the documented LGD-relevant core; explicit options always take precedence. */
const presets = {
    LLVM: { indent: 2, width: 80, braces: 'attach' }, Google: { indent: 2, width: 80, braces: 'attach' }, Chromium: { indent: 2, width: 80, braces: 'attach' },
    Mozilla: { indent: 2, width: 99, braces: 'mozilla' }, WebKit: { indent: 4, width: 0, braces: 'webkit' }, Microsoft: { indent: 4, width: 120, braces: 'allman' }, GNU: { indent: 2, width: 79, braces: 'gnu' }
};

/** @description Imports data-only clang-format YAML without running formatters, scripts or custom YAML constructors. */
const LgdClangFormat = {
    /** @description Parses bounded plain YAML mappings and selects general, JavaScript and LGD sections. */
    parse(text, filename = '.clang-format')
    {
        const result = { options: {}, rules: {}, issues: [], inheritParent: false, filename: filename };
        if(text.length > limits.bytes)
        {
            result.disabled = true;
            result.issues.push('The clang-format file exceeds the 256 KiB safety limit.');
            return result;
        }

        let depth = 0;
        let count = 0;
        try
        {
            const settings = {
                schema: yaml.JSON_SCHEMA,

                /** @description Aborts pathological YAML before traversing the imported preferences. */
                listener(event)
                {
                    depth += event === 'open' ? 1 : -1;
                    count++;
                    if(depth > limits.depth || count > limits.nodes)
                    {
                        throw new Error('The clang-format YAML exceeds the supported nesting or node limit.');
                    }
                }
            };
            const documents = [];
            const load = yaml.loadAll;
            load(text, document => documents.push(document), settings);
            for(const document of documents)
            {
                if(!document)
                {
                    continue;
                }

                if(typeof document !== 'object' || Array.isArray(document))
                {
                    throw new TypeError('Each clang-format YAML document must be a plain mapping.');
                }

                this.validateTree(document, new Set());
                if(document.Language && ![ 'JavaScript', 'LGD' ].includes(document.Language))
                {
                    continue;
                }

                this.map(document, result);
            }
        }
        catch(error)
        {
            result.disabled = true;
            result.options = {};
            result.rules = {};
            result.issues.push(`Cannot import ${filename}: ${error.message}`);
        }

        return result;
    },

    /** @description Rejects aliases, cycles, prototype properties and complex values unnecessary for supported style options. */
    validateTree(value, seen)
    {
        if(!value || typeof value !== 'object')
        {
            return;
        }

        if(Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value))
        {
            throw new Error('Only scalar values and unique plain mappings are supported; YAML aliases and sequences are not imported.');
        }

        seen.add(value);
        for(const [ key, child ] of Object.entries(value))
        {
            if([ '__proto__', 'constructor', 'prototype' ].includes(key))
            {
                throw new Error(`Unsafe YAML mapping key: ${key}.`);
            }

            this.validateTree(child, seen);
        }
    },

    /** @description Maps verified LGD equivalents and explains every unsupported source key. */
    map(configuration, result)
    {
        const basedOn = configuration.BasedOnStyle;
        const preset = presets[basedOn];
        if(preset)
        {
            this.set(result, 'indentation', 'size', preset.indent);
            this.set(result, 'indentation', 'style', 'space');
            this.set(result, 'wrapping', 'columnLimit', preset.width);
            this.set(result, 'braces', 'style', preset.braces);
            this.set(result, 'spacing', 'afterControlKeywords', true);
        }
        else if(basedOn === 'InheritParentConfig')
        {
            result.inheritParent = true;
        }
        else if(basedOn)
        {
            result.issues.push(`BasedOnStyle=${basedOn} is not a supported LGD preset projection.`);
        }

        for(const [ key, value ] of Object.entries(configuration))
        {
            if([ 'BasedOnStyle', 'Language' ].includes(key))
            {
                continue;
            }

            if(scalarMappings[key])
            {
                this.set(result, ...scalarMappings[key], value);
            }
            else if(inapplicable.has(key))
            {
                result.issues.push(`${key} has no corresponding LGD syntax and was not imported.`);
            }
            else if(!this.mapSpecial(key, value, configuration, result))
            {
                result.issues.push(`${key} is not supported by the LGD style importer and was not applied.`);
            }
        }
    },

    /** @description Handles enum and multi-option settings without conflating foreign languages with LGD grammar. */
    mapSpecial(key, value, configuration, result)
    {
        const lower = String(value).toLowerCase();
        const set = (group, option, entry) => this.set(result, group, option, entry);
        if(key === 'BreakBeforeBraces')
        {
            set('braces', 'style', lower);
            const attached = [ 'attach', 'linux', 'mozilla', 'webkit' ].includes(lower);
            set('braces', 'beforeElse', !attached);
            set('braces', 'beforeCatch', !attached);
            set('braces', 'beforeFinally', !attached);
        }
        else if(key === 'BraceWrapping')
        {
            if(configuration.BreakBeforeBraces === 'Custom')
            {
                this.mapBraceWrapping(value, result);
            }
        }
        else if(key === 'UseTab')
        {
            if(![ 'Never', 'ForIndentation', 'ForContinuationAndIndentation', 'AlignWithSpaces', 'Always' ].includes(value))
            {
                result.issues.push(`UseTab=${value} is not represented exactly; use native indentation.style for a supported choice.`);
            }
            else
            {
                set('indentation', 'style', value === 'Never' ? 'space' : 'tab');
                const usages = { ForIndentation: 'indentation', ForContinuationAndIndentation: 'always', AlignWithSpaces: 'continuation', Always: 'always' };
                set('indentation', 'tabUsage', usages[value] || 'always');
            }
        }
        else if(key === 'InsertBraces')
        {
            set('bracesRequired', 'mode', value ? 'always' : 'preserve');
        }
        else if(key === 'AllowShortBlocksOnASingleLine')
        {
            set('lineBreaks', 'shortBlocks', lower);
        }
        else if(key === 'AllowShortFunctionsOnASingleLine')
        {
            set('lineBreaks', 'shortFunctions', lower === 'none' ? 'never' : lower);
        }
        else if(key === 'AllowShortLambdasOnASingleLine')
        {
            set('lineBreaks', 'shortLambdas', lower === 'none' ? 'never' : lower);
        }
        else if(key === 'AllowShortIfStatementsOnASingleLine')
        {
            const styles = { Never: 'never', WithoutElse: 'withoutElse', AllIfsAndElse: 'all' };
            set('lineBreaks', 'shortIfs', styles[value]);
        }
        else if(key === 'SpaceInEmptyBraces')
        {
            set('spacing', 'insideEmptyBlockBraces', [ 'Block', 'Always' ].includes(value));
            set('spacing', 'insideEmptyObjectBraces', value === 'Always');
        }
        else if(key === 'SpaceBeforeParens')
        {
            if([ 'Never', 'Always', 'ControlStatements', 'ControlStatementsExceptControlMacros' ].includes(value))
            {
                set('spacing', 'afterControlKeywords', value !== 'Never');
                for(const option of [ 'beforeMethodParen', 'beforeFunctionParen', 'beforeCallParen' ])
                {
                    set('spacing', option, value === 'Always');
                }
            }
            else
            {
                result.issues.push(`SpaceBeforeParens=${value} requires a native per-context spacing choice.`);
            }
        }
        else if(key === 'SpacesInParentheses')
        {
            for(const option of [ 'insideControlParens', 'insideDeclarationParens', 'insideCallParens', 'insideOtherParens' ])
            {
                set('spacing', option, value);
            }
        }
        else if(key === 'AlignAfterOpenBracket')
        {
            if([ 'Align', 'DontAlign' ].includes(value))
            {
                set('wrapping', 'alignAfterOpenBracket', value === 'Align');
            }
            else
            {
                result.issues.push(`AlignAfterOpenBracket=${value} is not supported; use Align or DontAlign.`);
            }
        }
        else if(key === 'BinPackArguments' || key === 'BinPackParameters')
        {
            const packed = value === true || value === 'BinPack';
            set('wrapping', key === 'BinPackArguments' ? 'arguments' : 'parameters', packed ? 'binPack' : 'onePerLine');
        }
        else if(key === 'BreakBeforeBinaryOperators')
        {
            const values = { None: 'after', NonAssignment: 'beforeNonAssignment', All: 'before' };
            set('wrapping', 'binaryOperators', values[value]);
        }
        else if(key === 'BreakConstructorInitializers')
        {
            const values = { BeforeColon: 'beforeColon', AfterColon: 'afterColon' };
            set('wrapping', 'constructorInitializer', values[value]);
        }
        else if(key === 'SeparateDefinitionBlocks')
        {
            set('lineBreaks', 'separateDefinitions', lower === 'leave' ? 'preserve' : lower);
        }
        else if(key === 'ReflowComments' && value === false || key === 'SortIncludes' && (value === false || value === 'false'))
        {
            result.issues.push(`${key}=false is honored by preserving comment text and import order.`);
        }
        else if(key === 'DisableFormat')
        {
            if(value === true)
            {
                result.disabled = true;
            }
        }
        else
        {
            return false;
        }

        return true;
    },

    /** @description Maps custom clang brace locations only when Custom wrapping was selected. */
    mapBraceWrapping(wrapping, result)
    {
        const locations = { AfterClass: ['classes'], AfterStruct: [], AfterEnum: ['enums'], AfterFunction: [ 'functions', 'methods', 'constructors', 'accessors' ], AfterControlStatement: [ 'controlBlocks', 'switchBlocks', 'tryBlocks', 'elseBlocks', 'catchBlocks', 'finallyBlocks' ], AfterCaseLabel: ['caseBlocks'], BeforeLambdaBody: ['lambdas'] };
        const values = {};
        for(const [ key, value ] of Object.entries(wrapping || {}))
        {
            if(locations[key])
            {
                for(const location of locations[key])
                {
                    let placement = value === true || value === 'Always' ? 'nextLine' : 'sameLine';
                    if(value === 'MultiLine')
                    {
                        placement = 'nextLineIfMultiline';
                    }
                    else if(placement === 'nextLine' && wrapping.IndentBraces)
                    {
                        placement = 'nextLineIndented';
                    }

                    values[location] = placement;
                }
            }
            else if([ 'BeforeElse', 'BeforeCatch', 'BeforeWhile' ].includes(key))
            {
                this.set(result, 'braces', key[0].toLowerCase() + key.slice(1), value);
            }
            else if(key !== 'IndentBraces')
            {
                result.issues.push(`BraceWrapping.${key} has no supported LGD equivalent.`);
            }
        }

        this.set(result, 'braces', 'wrapping', values);
    },

    /** @description Keeps source projections sparse so later configuration layers can override individual options. */
    set(result, group, option, value)
    {
        if(value === undefined)
        {
            result.issues.push(`Invalid imported value for ${group}.${option}; the existing setting is retained.`);
            return;
        }

        result.options[group] ||= {};
        result.options[group][option] = value;
    }
};

module.exports = LgdClangFormat;
