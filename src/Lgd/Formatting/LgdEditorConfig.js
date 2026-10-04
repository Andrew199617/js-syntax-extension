const path = require('path');
const LgdFormattingOptions = require('./LgdFormattingOptions');
const LgdExpressionStyleOptions = require('./LgdExpressionStyleOptions');

/** @description Bounds parsing and matching while meeting standard property-length requirements. */
const limits = { key: 1024, value: 4096, pattern: 1024, path: 8192, nesting: 32, width: 16, work: 200000 };

/** @description Exact integer comparison avoids rounding numeric glob endpoints. */
const integer = globalThis.BigInt;

/** @description Direct Boolean translations retain separate contexts rather than treating every punctuation token alike. */
const booleanMappings = Object.fromEntries([
    [ 'csharp_space_after_keywords_in_control_flow_statements', [ 'spacing', 'afterControlKeywords' ] ],
    [ 'csharp_space_before_colon_in_inheritance_clause', [ 'spacing', 'beforeInheritanceColon' ] ],
    [ 'csharp_space_after_colon_in_inheritance_clause', [ 'spacing', 'afterInheritanceColon' ] ],
    [ 'csharp_space_between_method_declaration_parameter_list_parentheses', [ 'spacing', 'insideDeclarationParens' ] ],
    [ 'csharp_space_between_method_declaration_empty_parameter_list_parentheses', [ 'spacing', 'insideEmptyDeclarationParens' ] ],
    [ 'csharp_space_between_method_declaration_name_and_open_parenthesis', [ 'spacing', 'beforeMethodParen' ] ],
    [ 'csharp_space_between_method_call_parameter_list_parentheses', [ 'spacing', 'insideCallParens' ] ],
    [ 'csharp_space_between_method_call_empty_parameter_list_parentheses', [ 'spacing', 'insideEmptyCallParens' ] ],
    [ 'csharp_space_between_method_call_name_and_open_parenthesis', [ 'spacing', 'beforeCallParen' ] ],
    [ 'csharp_space_after_comma', [ 'spacing', 'afterComma' ] ],
    [ 'csharp_space_before_comma', [ 'spacing', 'beforeComma' ] ],
    [ 'csharp_space_after_dot', [ 'spacing', 'afterDot' ] ],
    [ 'csharp_space_before_dot', [ 'spacing', 'beforeDot' ] ],
    [ 'csharp_space_after_semicolon_in_for_statement', [ 'spacing', 'afterForSemicolon' ] ],
    [ 'csharp_space_before_semicolon_in_for_statement', [ 'spacing', 'beforeForSemicolon' ] ],
    [ 'csharp_space_before_open_square_brackets', [ 'spacing', 'beforeSquareBracket' ] ],
    [ 'csharp_space_between_empty_square_brackets', [ 'spacing', 'insideEmptySquareBrackets' ] ],
    [ 'csharp_space_between_square_brackets', [ 'spacing', 'insideSquareBrackets' ] ],
    [ 'csharp_new_line_before_else', [ 'braces', 'beforeElse' ] ],
    [ 'csharp_new_line_before_catch', [ 'braces', 'beforeCatch' ] ],
    [ 'csharp_new_line_before_finally', [ 'braces', 'beforeFinally' ] ],
    [ 'csharp_indent_case_contents', [ 'indentation', 'caseContents' ] ],
    [ 'csharp_indent_case_contents_when_block', [ 'indentation', 'caseBlocks' ] ],
    [ 'csharp_preserve_single_line_blocks', [ 'lineBreaks', 'preserveSingleLineBlocks' ] ],
    [ 'csharp_preserve_single_line_statements', [ 'lineBreaks', 'preserveSingleLineStatements' ] ],
    [ 'csharp_style_allow_blank_lines_between_consecutive_braces_experimental', [ 'lineBreaks', 'blankLinesBetweenClosingBraces' ] ],
    [ 'dotnet_style_allow_statement_immediately_after_block_experimental', [ 'lineBreaks', 'statementImmediatelyAfterBlock' ] ],
    [ 'csharp_style_allow_blank_line_after_colon_in_constructor_initializer_experimental', [ 'lineBreaks', 'blankLineAfterConstructorColon' ] ],
    [ 'csharp_style_allow_blank_line_after_token_in_conditional_expression_experimental', [ 'lineBreaks', 'blankLineAfterConditionalToken' ] ],
    [ 'csharp_style_allow_blank_line_after_arrow_expression_clause_experimental', [ 'lineBreaks', 'blankLineAfterArrow' ] ],
    [ 'csharp_style_allow_embedded_statements_on_same_line_experimental', [ 'lineBreaks', 'embeddedStatementsSameLine' ] ],
    [ 'csharp_space_after_cast', [ 'spacing', 'afterCast' ] ],
    [ 'trim_trailing_whitespace', [ 'whitespace', 'trimTrailingWhitespace' ] ]
]);

/** @description Compatible C# brace element names expand into independently configurable LGD locations. */
const braceMappings = Object.fromEntries([
    [ 'types', [ 'classes', 'interfaces', 'enums' ] ],
    [ 'methods', [ 'methods', 'constructors' ] ],
    [ 'local_functions', ['functions'] ],
    [ 'accessors', ['accessors'] ],
    [ 'lambdas', ['lambdas'] ],
    [ 'anonymous_methods', ['functions'] ],
    [ 'control_blocks', [ 'controlBlocks', 'switchBlocks', 'caseBlocks', 'tryBlocks', 'elseBlocks', 'catchBlocks', 'finallyBlocks' ] ],
    [ 'object_collection_array_initializers', ['objectLiterals'] ]
]);

/** @description Parses EditorConfig without filesystem access or executable project configuration. */
const LgdEditorConfig = {
    /** @description Preserves arbitrary values while lowercasing keys and enforcing preamble-only root. */
    parse(text, filename = '.editorconfig')
    {
        const parsed = { filename: filename, root: false, sections: [], issues: [] };
        let section = null;
        for(const [ index, original ] of text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u).entries())
        {
            const line = original.trim();
            if(!line || line.startsWith('#') || line.startsWith(';'))
            {
                continue;
            }

            if(line.startsWith('[') && line.endsWith(']'))
            {
                section = { glob: line.slice(1, -1), properties: Object.create(null), line: index + 1 };
                parsed.sections.push(section);
                if(!this.globNodes(section.glob))
                {
                    parsed.issues.push({ line: index + 1, key: section.glob, message: 'Unsupported or invalid EditorConfig section glob.' });
                }

                continue;
            }

            const equals = line.indexOf('=');
            if(equals < 1)
            {
                parsed.issues.push({ line: index + 1, message: 'Expected an EditorConfig property or section.' });
                continue;
            }

            const key = line.slice(0, equals).trim().toLowerCase();
            const value = line.slice(equals + 1).trim();
            if(key.length > limits.key || value.length > limits.value)
            {
                parsed.issues.push({ line: index + 1, key: key, message: 'EditorConfig property exceeds supported length.' });
                continue;
            }

            if(!section && key === 'root')
            {
                if([ 'true', 'false' ].includes(value.toLowerCase()))
                {
                    parsed.root = value.toLowerCase() === 'true';
                }
                else
                {
                    parsed.issues.push({ line: index + 1, key: key, message: 'EditorConfig root must be true or false.' });
                }
            }
            else if(!section || key === 'root')
            {
                parsed.issues.push({ line: index + 1, key: key, message: key === 'root' ? 'EditorConfig root belongs before the first section.' : 'EditorConfig properties require a matching section.' });
            }
            else
            {
                section.properties[key] = value;
            }
        }

        return parsed;
    },

    /** @description Applies matching sections in file order; unset removes inherited effects. */
    apply(parsed, relativePath, inherited = {})
    {
        const properties = Object.assign(Object.create(null), inherited);
        for(const section of parsed.sections)
        {
            if(this.matches(section.glob, relativePath))
            {
                for(const [ key, value ] of Object.entries(section.properties))
                {
                    if(value.toLowerCase() === 'unset')
                    {
                        delete properties[key];
                    }
                    else
                    {
                        properties[key] = value;
                    }
                }
            }
        }

        return properties;
    },

    /** @description Resolves parsed files ordered from root to nearest, ignoring non-ancestor files. */
    resolve(files, context)
    {
        let properties = Object.create(null);
        const issues = [];
        const filePath = context.filePath.replace(/\\/gu, '/');
        for(const parsed of files)
        {
            const directory = path.posix.dirname(parsed.filename.replace(/\\/gu, '/'));
            const relativePath = path.posix.relative(directory, filePath);
            if(relativePath === '..' || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath))
            {
                continue;
            }

            if(parsed.root)
            {
                properties = Object.create(null);
            }

            properties = this.apply(parsed, relativePath, properties);
            issues.push(...parsed.issues.map(issue => ({ ...issue, filename: parsed.filename })));
        }

        return { properties: properties, issues: issues };
    },

    /** @description Builds a bounded glob syntax tree rather than an exponential generated regular expression. */
    globNodes(pattern)
    {
        if(typeof pattern !== 'string' || !pattern || pattern.length > limits.pattern || pattern.endsWith('/'))
        {
            return null;
        }

        const state = { index: 0, depth: 0, invalid: false };
        const nodes = this.readGlob(pattern, state, false);
        return state.invalid ? null : nodes;
    },

    /** @description Reads stars, literals, classes and nested brace alternatives using bounded recursion. */
    readGlob(pattern, state, inBrace)
    {
        const nodes = [];
        while(state.index < pattern.length)
        {
            const character = pattern[state.index];
            if(inBrace && (character === ',' || character === '}'))
            {
                break;
            }

            state.index++;
            if(character === '\\')
            {
                nodes.push({ kind: 'literal', value: pattern[state.index] || '\\' });
                state.index++;
            }
            else if(character === '*')
            {
                const double = pattern[state.index] === '*';
                state.index += double ? 1 : 0;
                const directories = double && pattern[state.index] === '/';
                state.index += directories ? 1 : 0;
                let kind = double ? 'globstar' : 'star';
                if(directories)
                {
                    kind = 'directories';
                }

                nodes.push({ kind: kind });
            }
            else if(character === '?')
            {
                nodes.push({ kind: 'any' });
            }
            else if(character === '[')
            {
                const close = pattern.indexOf(']', state.index);
                if(close === -1)
                {
                    nodes.push({ kind: 'literal', value: '[' });
                }
                else
                {
                    let characters = pattern.slice(state.index, close);
                    const negated = characters.startsWith('!');
                    if(negated)
                    {
                        characters = characters.slice(1);
                    }

                    nodes.push({ kind: 'class', characters: characters, negated: negated });
                    state.index = close + 1;
                }
            }
            else if(character === '{')
            {
                nodes.push(this.readBrace(pattern, state));
            }
            else
            {
                nodes.push({ kind: 'literal', value: character });
            }

            if(state.invalid)
            {
                break;
            }
        }

        return nodes;
    },

    /** @description Numeric ranges are compared as integers without expanding huge ranges into alternatives. */
    readBrace(pattern, state)
    {
        const start = state.index - 1;
        const close = pattern.indexOf('}', state.index);
        const numeric = (/^(?<minimum>-?\d+)\.\.(?<maximum>-?\d+)$/u).exec(pattern.slice(state.index, close));
        if(close !== -1 && numeric)
        {
            state.index = close + 1;
            const minimum = integer(numeric.groups.minimum);
            const maximum = integer(numeric.groups.maximum);
            state.invalid = minimum >= maximum;
            return { kind: 'number', minimum: minimum, maximum: maximum };
        }

        state.depth++;
        if(state.depth > limits.nesting)
        {
            state.invalid = true;
            return { kind: 'literal', value: '' };
        }

        const alternatives = [this.readGlob(pattern, state, true)];
        while(pattern[state.index] === ',')
        {
            state.index++;
            alternatives.push(this.readGlob(pattern, state, true));
        }

        state.depth--;
        if(pattern[state.index] === '}')
        {
            state.index++;
            if(alternatives.length > 1)
            {
                return { kind: 'alternatives', alternatives: alternatives };
            }
        }

        return { kind: 'literal', value: pattern.slice(start, state.index) };
    },

    /** @description Matches the full source-relative path, or basename for sections without directory separators. */
    matches(pattern, relativePath)
    {
        const nodes = this.globNodes(pattern.startsWith('/') ? pattern.slice(1) : pattern);
        if(!nodes || relativePath.length > limits.path || relativePath.startsWith('../'))
        {
            return false;
        }

        const sourcePath = relativePath.replace(/\\/gu, '/');
        const hasSeparator = this.hasSeparator(nodes);
        const starts = new Set([0]);
        if(!hasSeparator && !pattern.startsWith('/'))
        {
            for(let index = 0; index < sourcePath.length; index++)
            {
                if(sourcePath[index] === '/')
                {
                    starts.add(index + 1);
                }
            }
        }

        const budget = { remaining: limits.work };
        return this.matchNodes(nodes, sourcePath, starts, budget).has(sourcePath.length);
    },

    /** @description Slashes inside bracket character sets are not directory separators. */
    hasSeparator(nodes)
    {
        return nodes.some(node =>
        {
            const direct = node.kind === 'directories' || node.kind === 'literal' && node.value.includes('/');
            const nested = node.alternatives && node.alternatives.some(alternative => this.hasSeparator(alternative));
            return direct || nested;
        });
    },

    /** @description Dynamic position sets prevent wildcard backtracking from taking exponential time. */
    matchNodes(nodes, candidate, positions, budget)
    {
        let current = positions;
        for(const node of nodes)
        {
            const next = new Set();
            for(const position of current)
            {
                budget.remaining--;
                if(budget.remaining < 0)
                {
                    return new Set();
                }

                this.matchNode(node, { candidate: candidate, position: position, budget: budget }, next);
            }

            current = next;
            if(current.size === 0)
            {
                break;
            }
        }

        return current;
    },

    /** @description Expands one glob token into reachable positions, preserving slash and integer-range boundaries. */
    matchNode(node, state, next)
    {
        const { candidate, position, budget } = state;
        if(node.kind === 'literal')
        {
            if(candidate.startsWith(node.value, position))
            {
                next.add(position + node.value.length);
            }
        }
        else if(node.kind === 'alternatives')
        {
            for(const alternative of node.alternatives)
            {
                for(const end of this.matchNodes(alternative, candidate, new Set([position]), budget))
                {
                    next.add(end);
                }
            }
        }
        else if([ 'star', 'globstar', 'directories' ].includes(node.kind))
        {
            next.add(position);
            for(let end = position; end < candidate.length; end++)
            {
                budget.remaining--;
                if(budget.remaining < 0 || node.kind === 'star' && candidate[end] === '/')
                {
                    break;
                }

                if(node.kind !== 'directories' || candidate[end] === '/')
                {
                    next.add(end + 1);
                }
            }
        }
        else if(node.kind === 'number')
        {
            this.matchNumber(node, state, next);
        }
        else if(position < candidate.length && candidate[position] !== '/')
        {
            if(node.kind === 'any' || node.kind === 'class' && node.characters.includes(candidate[position]) !== node.negated)
            {
                next.add(position + 1);
            }
        }
    },

    /** @description Numeric glob endpoints cannot execute code or allocate a range-sized array. */
    matchNumber(node, state, next)
    {
        const { candidate, position, budget } = state;
        let end = position + (candidate[position] === '-' ? 1 : 0);
        while(end < candidate.length && (/\d/u).test(candidate[end]))
        {
            budget.remaining--;
            if(budget.remaining < 0)
            {
                break;
            }

            end++;
            const number = integer(candidate.slice(position, end));
            if(number >= node.minimum && number <= node.maximum)
            {
                next.add(end);
            }
        }
    },

    /** @description Imports supported preferences only, reporting unimplemented properties without changing source code. */
    map(properties)
    {
        const result = { options: {}, rules: {}, issues: [] };
        const normalized = Object.fromEntries(Object.entries(properties).map(([ key, value ]) => [ key.toLowerCase(), String(value) ]));
        for(const [ key, original ] of Object.entries(normalized))
        {
            if(original.toLowerCase() === 'unset')
            {
                continue;
            }

            const supportsSeverity = key.startsWith('csharp_') || key.startsWith('dotnet_style_');
            const separator = supportsSeverity ? original.lastIndexOf(':') : -1;
            const value = (separator !== -1 ? original.slice(0, separator) : original).trim().toLowerCase();
            const severity = separator !== -1 ? original.slice(separator + 1).trim().toLowerCase() : null;
            const groups = this.mapProperty(result, key, value, normalized);
            if(groups && severity)
            {
                this.applySeverity(result, groups, severity, key);
            }
        }

        return result;
    },

    /** @description Sets a native option without overwriting unrelated group properties. */
    setOption(result, mapping, value)
    {
        const [ group, property ] = mapping;
        result.options[group] = { ...result.options[group], [property]: value };
        return [`${group}.${property}`];
    },

    /** @description Maps exact compatible values and leaves foreign-language semantics unimplemented. */
    mapProperty(result, key, value, properties)
    {
        const declarationGroups = require('./LgdDeclarationStyleImport').map(this, result, { key: key, value: value });

        if(declarationGroups !== null)
        {
            return declarationGroups;
        }

        if(Object.hasOwn(LgdExpressionStyleOptions.editorConfig, key))
        {
            return this.expressionOption(result, key, value);
        }

        if(Object.hasOwn(booleanMappings, key))
        {
            return this.booleanOption(result, key, value, booleanMappings[key]);
        }

        if(key === 'file_header_template')
        {
            const header = value === 'unset' ? '' : properties[key].replaceAll('\\n', '\n');
            return this.setOption(result, [ 'whitespace', 'fileHeader' ], header);
        }

        if(key === 'dotnet_diagnostic.ide0004.severity')
        {
            const levels = { none: 'off', off: 'off', warning: 'warning', error: 'error' };
            if(Object.hasOwn(levels, value))
            {
                result.rules['unnecessary-reference-cast'] = { severity: levels[value] };
            }
            else
            {
                this.unsupported(result, key, `Severity ${value} has no exact LGD severity equivalent.`);
            }

            return [];
        }

        if(key === 'dotnet_diagnostic.ide0073.severity')
        {
            this.applySeverity(result, ['whitespace.fileHeader'], value, key);
            return [];
        }

        if(key === 'dotnet_diagnostic.ide0035.severity')
        {
            this.applySeverity(result, ['cleanup.unreachableStatements'], value, key);
            return [];
        }

        if(key === 'dotnet_diagnostic.ide0055.severity')
        {
            this.applySeverity(result, LgdFormattingOptions.catalog.map(rule => rule.id.slice('lgd.format.'.length)), value, key);
            return [];
        }

        if(key === 'indent_size' || key === 'tab_width')
        {
            return this.indentOption(result, key, value, properties);
        }

        const enums = Object.fromEntries([
            [ 'csharp_space_around_declaration_statements', [ 'spacing', 'declarations', { false: 'normalize', ignore: 'preserve' } ] ],
            [ 'dotnet_separate_import_directive_groups', [ 'lineBreaks', 'importGroups', { true: 'origin', false: 'none' } ] ],
            [ 'indent_style', [ 'indentation', 'style', { tab: 'tab', space: 'space' } ] ],
            [ 'end_of_line', [ 'whitespace', 'endOfLine', Object.fromEntries([ [ 'lf', 'lf' ], [ 'crlf', 'crlf' ], [ 'cr', 'cr' ] ]) ] ],
            [ 'insert_final_newline', [ 'whitespace', 'finalNewline', { true: 'always', false: 'never' } ] ],
            [ 'csharp_space_around_binary_operators', [ 'spacing', 'binaryOperators', Object.fromEntries([ [ 'before_and_after', 'both' ], [ 'none', 'none' ], [ 'ignore', 'preserve' ] ]) ] ],
            [ 'csharp_indent_labels', [ 'indentation', 'labels', Object.fromEntries([ [ 'no_change', 'preserve' ], [ 'flush_left', 'flushLeft' ], [ 'one_less_than_current', 'oneLess' ] ]) ] ],
            [ 'csharp_new_line_before_members_in_object_initializers', [ 'lineBreaks', 'objectMembers', { true: 'onePerLine', false: 'singleLine' } ] ],
            [ 'csharp_prefer_braces', [ 'bracesRequired', 'mode', Object.fromEntries([ [ 'true', 'always' ], [ 'false', 'preserve' ], [ 'when_multiline', 'multiLine' ] ]) ] ],
            [ 'dotnet_style_allow_multiple_blank_lines_experimental', [ 'lineBreaks', 'maxEmptyLines', { false: 1 } ] ]
        ]);
        if(Object.hasOwn(enums, key))
        {
            const [ group, property, choices ] = enums[key];
            if(Object.hasOwn(choices, value))
            {
                return this.setOption(result, [ group, property ], choices[value]);
            }

            return this.unsupported(result, key, 'Unsupported EditorConfig value for this LGD option.');
        }

        if(key === 'csharp_new_line_before_open_brace')
        {
            return this.braceOption(result, key, value);
        }

        if(key === 'csharp_space_between_parentheses')
        {
            return this.parenthesisOption(result, key, value);
        }

        return this.unsupported(result, key, 'This EditorConfig property has no implemented LGD formatting mapping.');
    },

    /** @description Imports only the guarded expression subset, retaining independent option severity. */
    expressionOption(result, key, value)
    {
        const option = LgdExpressionStyleOptions.editorConfig[key];
        let mode = value;
        if(option === 'lambdaBodies')
        {
            const modes = Object.fromEntries([ [ 'true', 'always' ], [ 'false', 'never' ], [ 'when_on_single_line', 'when_on_single_line' ] ]);
            mode = modes[value];
        }
        else if(!option.startsWith('parentheses'))
        {
            if(value !== 'true' && value !== 'false')
            {
                return this.unsupported(result, key, 'Expected true or false.');
            }

            mode = value === 'true' ? 'prefer' : 'preserve';
        }

        if(!LgdExpressionStyleOptions.catalog.properties[option].enum.includes(mode))
        {
            return this.unsupported(result, key, 'Unsupported parentheses preference.');
        }

        return this.setOption(result, [ 'expressions', option ], mode);
    },

    /** @description Invalid Boolean values do not enable an option through JavaScript truthiness. */
    booleanOption(result, key, value, mapping)
    {
        if(value !== 'true' && value !== 'false')
        {
            return this.unsupported(result, key, 'Expected true or false.');
        }

        return this.setOption(result, mapping, value === 'true');
    },

    /** @description Resolves tab-relative indentation without pretending an unknown editor tab width is four. */
    indentOption(result, key, value, properties)
    {
        let raw = value;
        if(key === 'indent_size' && value === 'tab')
        {
            raw = String(properties['tab_width'] || '').toLowerCase();
            if(!raw)
            {
                return this.unsupported(result, key, 'indent_size=tab requires tab_width or a supplied editor tab width.');
            }
        }

        if(!(/^\d+$/u).test(raw) || Number(raw) < 1 || Number(raw) > limits.width)
        {
            return this.unsupported(result, key, 'LGD supports indentation widths from 1 through 16.');
        }

        const groups = this.setOption(result, [ 'indentation', key === 'indent_size' ? 'size' : 'tabWidth' ], Number(raw));
        if(key === 'indent_size' && !properties['tab_width'])
        {
            this.setOption(result, [ 'indentation', 'tabWidth' ], Number(raw));
        }

        return groups;
    },

    /** @description Maps brace code-element lists without applying C# constructs that LGD does not implement. */
    braceOption(result, key, value)
    {
        const locations = LgdFormattingOptions.braceLocations.filter(location => location !== 'objectPatterns');
        const wrapping = Object.fromEntries(locations.map(location => [ location, 'sameLine' ]));
        if(value === 'all')
        {
            for(const location of locations)
            {
                wrapping[location] = 'nextLine';
            }
        }
        else if(value !== 'none')
        {
            for(const element of value.split(',').map(part => part.trim()))
            {
                if(!Object.hasOwn(braceMappings, element))
                {
                    return this.unsupported(result, key, `Unsupported C# brace element: ${element}.`);
                }

                for(const location of braceMappings[element])
                {
                    wrapping[location] = 'nextLine';
                }
            }
        }

        this.setOption(result, [ 'braces', 'wrapping' ], wrapping);
        return locations.map(location => `braces.${location}`);
    },

    /** @description C# grouping/control spacing does not override separate call and declaration preferences. */
    parenthesisOption(result, key, value)
    {
        const elements = value === 'false' ? [] : value.split(',').map(part => part.trim());
        if(elements.some(element => ![ 'control_flow_statements', 'expressions', 'type_casts' ].includes(element)))
        {
            return this.unsupported(result, key, 'Only control_flow_statements, expressions and type_casts have LGD parenthesis mappings.');
        }

        const control = this.setOption(result, [ 'spacing', 'insideControlParens' ], elements.includes('control_flow_statements'));
        const expressions = this.setOption(result, [ 'spacing', 'insideOtherParens' ], elements.includes('expressions'));
        const casts = this.setOption(result, [ 'spacing', 'insideCastParens' ], elements.includes('type_casts'));
        return [ ...control, ...expressions, ...casts ];
    },

    /** @description Severity imports never authorize a fix or suppress an LGD compiler error. */
    applySeverity(result, groups, severity, key)
    {
        const levels = { none: 'off', off: 'off', warning: 'warning', error: 'error' };
        if(!Object.hasOwn(levels, severity))
        {
            this.unsupported(result, key, `Severity ${severity} has no exact LGD severity equivalent.`);
            return;
        }

        for(const group of groups)
        {
            const id = `lgd.format.${group}`;
            result.rules[id] = { ...result.rules[id], severity: levels[severity] };
        }
    },

    /** @description Unrecognized options remain visible in the compatibility report and never mutate defaults. */
    unsupported(result, key, message)
    {
        result.issues.push({ key: key, message: message });
        return null;
    }
};

module.exports = LgdEditorConfig;
