const vscode = require('vscode');
const LgdModuleBindings = require('../Compilers/LgdModuleBindings');
const LgdMirrorCompletion = require('./LgdMirrorCompletion');
const LgdTypeContext = require('./LgdTypeContext');
const LgdAmbientTypes = require('../Compilers/LgdAmbientTypes');
const { tsTypeMap } = require('../Compilers/LgdTypeMaps');
const { collectContractBindings } = require('../Compilers/LgdContractBindings');
const { visibleBindings } = require('../Compilers/LgdBaseChecker');
const LgdAccessibilityEditor = require('./LgdAccessibilityEditor');
const { maskCode } = require('../Compilers/LgdInfer');

/** @import { CompletionItem, Position, TextDocument } from 'vscode' */

/**
 * @description Provides member completions for LGD documents. After 'object.',
 * lists the members of the LGD-declared object from the language service type
 * summary (object literal members, nominal type members, and cross-file exports).
 * After 'this.', lists the enclosing object literal members plus the properties its
 * create() method assigns.
 * @type {LgdCompletionProviderType}
 */
const LgdCompletionProvider = {
    /**
     * @description Creates a completion provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdCompletionProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdCompletionProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides member completion items for the object named before the dot
     * at the cursor. Returns null when the cursor is not after a member access or the
     * object has no known members, leaving other providers to answer. A rejected promise
     * is left to VS Code, which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position.
     * @returns {Promise<Array<CompletionItem>|null>} the member items, or null when unavailable.
     */
    async provideCompletionItems(document, position)
    {
        const state = this.languageService.getState(document.uri);
        const text = document.getText();
        const offset = document.offsetAt(position);
        const code = maskCode(text, true);
        const insideText = this.languageService.isInsideStringOrComment(text, offset);
        if(insideText && !this._isExecutablePosition(text, code, offset))
        {
            return null;
        }

        const typeContext = LgdTypeContext.find(text, offset, state, { allowRecoveredHeads: !insideText });
        if(typeContext)
        {
            return this.typeCompletionItems(document, state, typeContext);
        }

        const lineStart = new vscode.Position(position.line, 0);
        const prefix = code.slice(document.offsetAt(lineStart), document.offsetAt(position));
        const match = (/(?<objectName>[$A-Z_a-z][\w$]*)\??\.[\w$]*$/).exec(prefix);
        if(!match)
        {
            return LgdMirrorCompletion.provide(this.languageService, document, position);
        }

        if(match.groups.objectName === 'this')
        {
            const candidates = this.languageService.getThisMembers(document, position);
            const members = LgdAccessibilityEditor.filter(state, position, 'this', candidates);
            if(members.length === 0)
            {
                return null;
            }

            return members.map(member => this.toCompletionItem(member));
        }

        const summary = await this.languageService.getTypeSummary(document.uri, match.groups.objectName);
        if(!summary || summary.members.length === 0)
        {
            return LgdMirrorCompletion.provide(this.languageService, document, position);
        }

        const candidates = summary.kind === 'class' ? summary.members.filter(member => member.static) : summary.members;
        const members = LgdAccessibilityEditor.filter(state, position, match.groups.objectName, candidates);
        return members.map(member => this.toCompletionItem(member));
    },

    _isExecutablePosition(text, masked, offset)
    {
        let previous = offset - 1;
        while(previous >= 0 && (/\s/).test(text[previous]))
        {
            previous--;
        }

        const character = text[previous];
        const quote = [ '"', "'", '`' ].includes(character);
        return previous >= 0 && !quote && character === masked[previous];
    },

    /** @description Reuses current metadata or recovers local declarations from the exact edited source. */
    currentTypeDeclarations(document, state, text)
    {
        if(state?.compiledText === text && state.compiledVersion === document.version)
        {
            return state.declarations || [];
        }

        return this.languageService.compiler.parse(text, state?.externals || new Map(), { deferAnalysis: true }).allDeclarations;
    },

    /** @description Completes known local, imported, and ambient type names in the exact annotation token. */
    typeCompletionItems(document, state, context)
    {
        const imports = LgdModuleBindings.imports(document.getText());
        const ambient = LgdAmbientTypes.forSource(document.uri.fsPath, imports);
        const symbols = new Map();
        if(!context.qualifier)
        {
            for(const name of Object.keys(tsTypeMap))
            {
                symbols.set(name, { name: name, kind: 'keyword' });
            }

            for(const name of [ 'number', 'string', 'boolean', 'bigint', 'symbol', 'object' ])
            {
                symbols.set(name, { name: name, kind: 'keyword' });
            }

            if(context.allowVoid) symbols.set('void', { name: 'void', kind: 'keyword' });
        }

        for(const symbol of ambient.completions(context.qualifier))
        {
            if(!symbols.has(symbol.name)) symbols.set(symbol.name, symbol);
        }

        const text = document.getText();
        const declarations = this.currentTypeDeclarations(document, state, text);
        const visibilityOffset = Math.min(context.start, Math.max(0, text.length - 1));
        const visible = visibleBindings(collectContractBindings(text, declarations, state?.externals || new Map()), visibilityOffset);
        const namespace = context.qualifier && visible.get(context.qualifier);
        if(namespace && namespace.kind !== 'moduleNamespace' && !namespace.unresolvedImport)
        {
            return [];
        }

        for(const [ name, declaration ] of visible)
        {
            let label = name;
            if(context.qualifier)
            {
                if(!name.startsWith(`${context.qualifier}.`))
                {
                    continue;
                }

                label = name.slice(context.qualifier.length + 1);
                if(label.includes('.'))
                {
                    continue;
                }
            }
            else if(name.includes('.'))
            {
                continue;
            }

            let kind = declaration.contractKind || declaration.kind;
            if(kind === 'moduleNamespace') kind = 'module';
            const named = declaration.typeName && declaration.typeName !== 'Unknown' && (/^[A-Z]/).test(name);
            const declaredType = [ 'class', 'interface', 'enum', 'module' ].includes(kind) || named;
            if(declaredType) symbols.set(label, { name: label, kind: kind || 'typeAlias' });
            else if(!declaration.unresolvedImport) symbols.delete(label);
        }

        const kinds = { keyword: vscode.CompletionItemKind.Keyword, class: vscode.CompletionItemKind.Class,
            interface: vscode.CompletionItemKind.Interface, enum: vscode.CompletionItemKind.Enum,
            module: vscode.CompletionItemKind.Module, typeAlias: vscode.CompletionItemKind.TypeParameter };
        const prefix = context.prefix.toLowerCase();
        return [...symbols.values()].filter(symbol =>
        {
            const allowed = !context.heritage || [ 'class', 'interface', 'module' ].includes(symbol.kind);
            return allowed && symbol.name.toLowerCase().startsWith(prefix);
        })
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(symbol =>
            {
                const item = new vscode.CompletionItem(symbol.name, kinds[symbol.kind]);
                item.range = new vscode.Range(document.positionAt(context.start), document.positionAt(context.end));
                item.insertText = symbol.name;
                item.filterText = symbol.name;
                item.sortText = symbol.name;
                return item;
            });
    },

    /**
     * @description Converts an LGD member record to a VS Code completion item.
     * @param {Object} member the {name, kind} member, kind being 'method' or 'property'.
     * @returns {CompletionItem} the completion item.
     */
    toCompletionItem(member)
    {
        const kind = member.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property;
        return new vscode.CompletionItem(member.name, kind);
    }
};

module.exports = LgdCompletionProvider;
