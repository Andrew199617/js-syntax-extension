const vscode = require('vscode');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const StatusBarMessage = require('../Logging/StatusBarMessage');

// Supported categories for status bar notifications.
const StatusBarMessageTypes = require('../Logging/StatusBarMessageTypes');

/** @import { ExtensionContext, Range, TextDocument, TextEditorOptions } from 'vscode' */

/** @description Converts the selected conditional into a guard clause. */
const InvertIf = {
    /** @description Creates an instance that plans and applies if-statement inversions. */
    create()
    {
        return Object.create(InvertIf);
    },

    /**
     * @description Plans a guard clause, returning null when the selection cannot be safely inverted.
     * @param {string} source Complete document text.
     * @param {{ start: number, end: number }} selection Selected character offsets in the source.
     * @param {{ languageId?: string, tabSize?: number | string, insertSpaces?: boolean | string }} [settings={}] Syntax and indentation preferences.
     */
    createEdit(source, selection, settings = {})
    {
        try
        {
            const syntax = this.parseSource(source, settings.languageId);
            const statementPath = this.findSelectedIf(syntax, source, selection);
            if(!statementPath)
            {
                return null;
            }

            const context = {
                source: source,
                tokens: syntax.tokens,
                comments: syntax.comments,
                newline: source.includes('\r\n') ? '\r\n' : '\n'
            };
            const edit = this.buildEdit(statementPath, context, settings);
            if(edit)
            {
                // Catch collisions and unsupported syntax before offering or applying an edit.
                this.parseSource(source.slice(0, edit.start) + edit.text + source.slice(edit.end), settings.languageId);
            }

            return edit;
        }
        catch(error)
        {
            if(error instanceof SyntaxError)
            {
                return null;
            }

            throw error;
        }
    },

    /**
     * @description Plans an inversion for the selected document range without applying it.
     * @param {TextDocument} document Document containing the if statement.
     * @param {Range} range Range selecting the if statement or its condition.
     * @param {TextEditorOptions} [options={}] Editor indentation preferences.
     */
    getEdit(document, range, options = {})
    {
        const selection = {
            start: document.offsetAt(range.start),
            end: document.offsetAt(range.end)
        };
        const settings = {
            languageId: document.languageId,
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces
        };

        return this.createEdit(document.getText(), selection, settings);
    },

    /**
     * @description Applies a safe inversion in the active editor and reports whether the edit was accepted.
     * @param {TextDocument} [document] Target document; defaults to the active editor's document.
     * @param {Range} [range] Target range; defaults to the active editor's selection.
     * @returns {Promise<boolean>} Whether the editor accepted an inversion.
     */
    async executeCommand(document, range)
    {
        const editor = vscode.window.activeTextEditor;
        if(!editor || document && document !== editor.document)
        {
            return false;
        }

        const targetDocument = document || editor.document;
        const targetRange = range || editor.selection;
        const edit = this.getEdit(targetDocument, targetRange, editor.options);
        if(!edit)
        {
            return false;
        }

        const replacementRange = new vscode.Range(
            targetDocument.positionAt(edit.start),
            targetDocument.positionAt(edit.end)
        );
        function applyReplacement(builder)
        {
            builder.replace(replacementRange, edit.text);
        }

        return await editor.edit(applyReplacement);
    },

    /**
     * @description Registers the invert-if command and disposes it with the extension.
     * @param {ExtensionContext} context Extension context that owns the command registration.
     */
    register(context)
    {
        const executeInversion = async (document, range) =>
        {
            const success = await this.executeCommand(document, range);
            if(!success)
            {
                StatusBarMessage.show(
                    'Cannot safely turn this if statement into a guard clause. Select its condition and check the following code.',
                    StatusBarMessageTypes.WARNING
                );
            }

            return success;
        };

        const command = vscode.commands.registerCommand('lgd.invertIf', executeInversion);
        context.subscriptions.push(command);
    },

    /** @description Parses the selected language with the tokens needed to preserve source formatting. */
    parseSource(source, languageId)
    {
        const plugins = [];
        if(languageId !== 'typescript')
        {
            plugins.push('jsx');
        }

        if(languageId === 'typescript' || languageId === 'typescriptreact')
        {
            plugins.push('typescript');
        }

        const options = { sourceType: 'unambiguous', plugins: plugins, tokens: true };
        return parser.parse(source, options);
    },

    /** @description Finds the innermost if statement whose header contains the selection. */
    findSelectedIf(syntax, source, selection)
    {
        let selectedPath = null;
        const visitor = {
            IfStatement(statementPath)
            {
                const statement = statementPath.node;
                const lineStart = source.lastIndexOf('\n', statement.start - 1) + 1;
                const prefix = source.slice(lineStart, statement.start);
                let start = statement.start;
                if(!prefix.trim())
                {
                    start = lineStart;
                }

                if(selection.start < start || selection.start > statement.consequent.start)
                {
                    return;
                }

                function selectsFollowingCode(token)
                {
                    if(token.start < statement.end || token.start >= selection.end)
                    {
                        return false;
                    }

                    return typeof token.type !== 'string' && token.type.label !== '}';
                }

                if(selection.end > statement.end)
                {
                    // Whole-line selections may include comments and enclosing closing braces.
                    if(syntax.tokens.some(selectsFollowingCode))
                    {
                        return;
                    }
                }

                selectedPath = statementPath;
            }
        };
        traverse(syntax, visitor);
        return selectedPath;
    },

    /** @description Identifies an explicit return, throw, continue, or break statement. */
    isExit(statement)
    {
        return statement && [ 'ReturnStatement', 'ThrowStatement', 'ContinueStatement', 'BreakStatement' ].includes(statement.type);
    },

    /** @description Checks whether a statement exits on every branch recognized by the transform. */
    alwaysExits(statement)
    {
        if(!statement)
        {
            return false;
        }

        if(this.isExit(statement))
        {
            return true;
        }

        if(statement.type === 'BlockStatement')
        {
            return statement.body.some(branch => this.alwaysExits(branch));
        }

        if(statement.type === 'IfStatement')
        {
            return this.alwaysExits(statement.consequent) && this.alwaysExits(statement.alternate);
        }

        return false;
    },

    /** @description Finds an exit that preserves the selected statement's fallthrough behavior. */
    findFallthroughExit(statementPath, source)
    {
        let current = statementPath;
        while(current.parentPath)
        {
            const parent = current.parentPath;
            if(current.inList)
            {
                const next = current.container[current.key + 1];
                if(next)
                {
                    // Copy only a sibling exit, keeping name resolution and resource disposal order.
                    if(current === statementPath && this.isExit(next))
                    {
                        return source.slice(next.start, next.end);
                    }

                    return null;
                }
            }

            if(parent.isFunction() && current.key === 'body')
            {
                return 'return;';
            }

            if(parent.isLoop() && current.key === 'body')
            {
                return 'continue;';
            }

            if(parent.isBlockStatement() || parent.isIfStatement())
            {
                current = parent;
                continue;
            }

            // Do not jump across try/finally, labels, switches, or the module boundary.
            return null;
        }

        return null;
    },

    /**
     * @description Rebuilds a binary expression while preserving parentheses, comments, and operator spacing.
     * @returns {string}
     */
    binaryText(node, context, replacement)
    {
        const { source, tokens } = context;
        function matchesOperator(token)
        {
            return typeof token.type !== 'string' && token.start >= node.left.end && token.end <= node.right.start && token.value === node.operator;
        }

        const token = tokens.find(matchesOperator);
        return [
            source.slice(node.start, node.left.start),
            replacement.left,
            source.slice(node.left.end, token.start),
            replacement.operator,
            source.slice(token.end, node.right.start),
            replacement.right,
            source.slice(node.right.end, node.end)
        ].join('');
    },

    /** @description Negates an expression while preserving truthiness, evaluation order, and comments. */
    negateExpression(node, context)
    {
        const { source } = context;
        const original = source.slice(node.start, node.end);
        if(node.type === 'UnaryExpression' && node.operator === '!')
        {
            return original.slice(1).trimStart();
        }

        if(node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||'))
        {
            let left = this.negateExpression(node.left, context);
            let right = this.negateExpression(node.right, context);
            if(node.left.type === 'LogicalExpression')
            {
                left = `(${left})`;
            }

            if(node.right.type === 'LogicalExpression')
            {
                right = `(${right})`;
            }

            let operator = '&&';
            if(node.operator === '&&')
            {
                operator = '||';
            }

            const replacement = { left: left, operator: operator, right: right };
            return this.binaryText(node, context, replacement);
        }

        const opposites = { '===': '!==', '!==': '===', '==': '!=', '!=': '==' };
        if(node.type === 'BinaryExpression' && opposites[node.operator])
        {
            const replacement = {
                left: source.slice(node.left.start, node.left.end),
                operator: opposites[node.operator],
                right: source.slice(node.right.start, node.right.end)
            };

            return this.binaryText(node, context, replacement);
        }

        const simpleTypes = [ 'Identifier', 'MemberExpression', 'OptionalMemberExpression', 'CallExpression', 'OptionalCallExpression', 'BooleanLiteral' ];
        if(simpleTypes.includes(node.type))
        {
            return `!${original}`;
        }

        // Relational opposites are not complements for NaN. Preserve JavaScript truthiness.
        return `!(${original})`;
    },

    /** @description Reads the leading whitespace on the line containing a source offset. */
    getIndent(source, offset)
    {
        const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
        return source.slice(lineStart, offset).match(/^(?<indent>[\t ]*)/u).groups.indent;
    },

    /** @description Infers one indentation level from the existing body or editor preferences. */
    getIndentUnit(statement, source, settings)
    {
        const indent = this.getIndent(source, statement.start);
        let first = statement.consequent;
        if(first.type === 'BlockStatement')
        {
            first = first.body[0];
        }

        if(first)
        {
            const bodyIndent = this.getIndent(source, first.start);
            if(first.loc.start.line > statement.loc.start.line && bodyIndent.startsWith(indent) && bodyIndent.length > indent.length)
            {
                return bodyIndent.slice(indent.length);
            }
        }

        if(settings.insertSpaces === false || indent.includes('\t'))
        {
            return '\t';
        }

        let tabSize = 4;
        if(Number.isInteger(settings.tabSize) && settings.tabSize > 0)
        {
            tabSize = settings.tabSize;
        }

        return ' '.repeat(tabSize);
    },

    /**
     * @description Reindents a statement body without changing literal values, optionally retaining its block.
     * @returns {string}
     */
    bodyText(node, context, indentation, keepBlock = false)
    {
        const { source, tokens } = context;
        let start = node.start;
        let end = node.end;
        if(node.type === 'BlockStatement' && !keepBlock)
        {
            start++;
            end--;
        }

        const fragment = source.slice(start, end);
        const lines = fragment.split('\n');
        const firstContent = fragment.search(/\S/u);
        if(firstContent < 0)
        {
            return '';
        }

        const originalIndent = this.getIndent(source, start + firstContent);
        let offset = start;
        const result = lines.map((line, index) =>
        {
            const lineOffset = offset;
            offset += line.length + 1;

            // Leading spaces inside template strings, JSX text and continued strings are values.
            const insideToken = tokens.some(token => token.start < lineOffset && token.end > lineOffset);
            if(index > 0 && insideToken)
            {
                return line;
            }

            if(!line.trim())
            {
                return line;
            }

            if(index === 0)
            {
                return indentation + line.trimStart();
            }

            if(line.startsWith(originalIndent))
            {
                return indentation + line.slice(originalIndent.length);
            }

            return line;
        });

        return result.join('\n').trim();
    },

    /** @description Checks whether lifting the if body requires retaining its original lexical scope. */
    needsOriginalScope(statementPath)
    {
        const consequent = statementPath.get('consequent');
        if(!consequent.isBlockStatement())
        {
            return consequent.isFunctionDeclaration();
        }

        const declarations = consequent.node.body;
        if(declarations.some(statement => statement.type === 'FunctionDeclaration' || statement.kind === 'using' || statement.kind === 'await using'))
        {
            return true;
        }

        const names = new Set(this.blockBindings(consequent));
        if(!names.size)
        {
            return false;
        }

        let preserveScope = false;
        const destination = statementPath.scope;
        if(destination.path.isProgram())
        {
            return true;
        }

        for(const name of names)
        {
            if(destination.hasBinding(name))
            {
                return true;
            }
        }

        const visitor = {
            Identifier(identifierPath)
            {
                const identifier = identifierPath.node;
                const outsideBody = identifier.start < consequent.node.start || identifier.end > consequent.node.end;
                if(identifier.name === 'eval' || outsideBody && names.has(identifier.name))
                {
                    preserveScope = true;
                    identifierPath.stop();
                }
            }
        };
        destination.path.traverse(visitor);
        return preserveScope;
    },

    /**
     * @description Lists a block's lexical bindings, including TypeScript declarations omitted by Babel's scope map.
     * @returns {string[]}
     */
    blockBindings(bodyPath)
    {
        if(!bodyPath.isBlockStatement())
        {
            return [];
        }

        const names = new Set(Object.keys(bodyPath.scope.bindings));
        for(const statement of bodyPath.node.body)
        {
            if(statement.type.startsWith('TS') && statement.id?.type === 'Identifier')
            {
                names.add(statement.id.name);
            }
        }

        return Array.from(names);
    },

    /** @description Checks for a line comment immediately before a block's closing brace. */
    hasTrailingLineComment(body, context)
    {
        if(body.type !== 'BlockStatement')
        {
            return false;
        }

        function isTrailingComment(comment)
        {
            if(comment.type !== 'CommentLine' || comment.start < body.start || comment.end >= body.end)
            {
                return false;
            }

            return !context.source.slice(comment.end, body.end - 1).trim();
        }

        return context.comments.some(isTrailingComment);
    },

    /** @description Builds a guard clause and lifted body when control flow and scope can be preserved. */
    buildEdit(statementPath, context, settings)
    {
        const statement = statementPath.node;
        if(statement.consequent.type === 'FunctionDeclaration' || statement.alternate?.type === 'FunctionDeclaration')
        {
            // Unbraced function declarations have legacy hoisting rules that a guard would change.
            return null;
        }

        let exit = null;
        if(!this.alwaysExits(statement.alternate))
        {
            exit = this.findFallthroughExit(statementPath, context.source);
            if(!exit)
            {
                return null;
            }
        }

        const { source, newline } = context;
        const indent = this.getIndent(source, statement.start);
        const unit = this.getIndentUnit(statement, source, settings);
        let contentIndent = indent;
        const needsWrapper = !statementPath.inList;
        if(needsWrapper)
        {
            contentIndent += unit;
        }

        const guardIndent = contentIndent + unit;
        let bodyPrefix = source.slice(statement.test.end, statement.consequent.start);
        if(statement.consequent.type !== 'BlockStatement')
        {
            bodyPrefix = bodyPrefix.replace(/(?<newline>\r?\n)[\t ]*$/u, `$<newline>${contentIndent}`);
        }

        const header = source.slice(statement.start, statement.test.start)
            + this.negateExpression(statement.test, context)
            + bodyPrefix;
        const guardParts = [];
        if(statement.alternate)
        {
            // Keep the else block's lexical scope when appending an exit copied from outside it.
            const keepElseBlock = Boolean(exit) && this.blockBindings(statementPath.get('alternate')).length > 0;
            guardParts.push(this.bodyText(statement.alternate, context, guardIndent, keepElseBlock));
            const comments = context.comments.filter(comment => comment.start >= statement.consequent.end && comment.end <= statement.alternate.start);
            if(comments.length)
            {
                guardParts.unshift(comments.map(comment => source.slice(comment.start, comment.end)).join(newline + guardIndent));
            }
        }

        if(exit)
        {
            guardParts.push(exit);
        }

        const guardBody = guardParts.filter(Boolean).join(newline + guardIndent);
        const lifted = this.bodyText(statement.consequent, context, contentIndent, this.needsOriginalScope(statementPath));
        let replacement = `${header}{${newline}${guardIndent}${guardBody}${newline}${contentIndent}}`;
        if(lifted)
        {
            replacement += `${newline}${newline}${contentIndent}${lifted}`;
        }

        if(needsWrapper)
        {
            replacement = `{${newline}${contentIndent}${replacement}${newline}${indent}}`;
        }

        else if(lifted && this.hasTrailingLineComment(statement.consequent, context))
        {
            // The removed closing brace may have separated a line comment from same-line following code.
            replacement += newline + indent;
        }

        return { start: statement.start, end: statement.end, text: replacement };
    }
};

module.exports = InvertIf;
