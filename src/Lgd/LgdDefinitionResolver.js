const LgdClassMemberLookup = require('./LgdClassMemberLookup');
const vscode = require('vscode');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('../Compilers/LgdInfer');
const { rootTypeName } = require('../Compilers/LgdTypeMaps');
const { collectScopes, collectBindings, visibleBindings } = require('../Compilers/LgdBaseChecker');

/**
 * @description Tests whether the cursor is on an LGD type erased from the JavaScript mirror.
 * @param {Object} state the source document state.
 * @param {number} offset the source offset.
 * @param {string} name the source word.
 * @returns {boolean} whether a declaration or parameter has this exact type name.
 */
function isTypeReference(state, offset, name)
{
    for(const declaration of state.declarations)
    {
        if(rootTypeName(declaration.typeName) === name && offset >= declaration.typeStart && offset < declaration.typeEnd)
        {
            return true;
        }

        for(const heritage of declaration.heritage || [])
        {
            if(heritage.name === name && offset >= heritage.start && offset < heritage.end)
            {
                return true;
            }
        }

        for(const member of declaration.classMembers || [])
        {
            const propertyStart = declaration.initializerStart + member.propertyTypeStart;
            const propertyEnd = declaration.initializerStart + member.propertyTypeEnd;
            if(rootTypeName(member.propertyTypeName) === name && offset >= propertyStart && offset < propertyEnd)
            {
                return true;
            }
        }

        const groups = [ declaration.typedParams, ...declaration.methodTypedParams || [] ];
        for(const group of groups)
        {
            if(!group)
            {
                continue;
            }

            const returnStart = declaration.initializerStart + group.returnTypeStart;
            const returnEnd = declaration.initializerStart + group.returnTypeEnd;
            if(rootTypeName(group.returnTypeName) === name && offset >= returnStart && offset < returnEnd)
            {
                return true;
            }

            for(const parameter of group.params)
            {
                const start = declaration.initializerStart + parameter.typeStart;
                const end = declaration.initializerStart + parameter.typeEnd;
                if(rootTypeName(parameter.typeName) === name && offset >= start && offset < end)
                {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * @description Finds a lexical direct require binding in the compiled mirror. Using Babel's
 * scope excludes unrelated property names and shadowing locals without replacing JS providers.
 * @param {Object} state the source document state.
 * @param {number} offset the source cursor offset.
 * @param {string} name the source word.
 * @returns {Object|null} the source initializer offsets for the direct require, or null.
 */
function findRequireDeclaration(state, offset, name)
{
    let syntax;
    try
    {
        syntax = parse(state.jsDocument.getText(), { sourceType: 'unambiguous', allowReturnOutsideFunction: true });
    }
    catch
    {
        // Incomplete edits still get the built-in provider's best available result.
        return null;
    }

    const jsOffset = state.map.toOutput(offset);
    const typeReference = isTypeReference(state, offset, name);
    let declaration = null;
    const visitor = {
        /** @description Resolves the identifier under the cursor to its original require binding. */
        Identifier: identifierPath =>
        {
            const node = identifierPath.node;
            if(jsOffset < node.start || jsOffset >= node.end || !typeReference && node.name !== name)
            {
                return;
            }

            const binding = identifierPath.scope.getBinding(name);
            if(!binding || !binding.path.isVariableDeclarator())
            {
                return;
            }

            if(!typeReference && !identifierPath.isReferencedIdentifier() && binding.identifier !== node)
            {
                return;
            }

            const initializer = binding.path.node.init;
            if(!initializer || initializer.type !== 'CallExpression')
            {
                return;
            }

            const callee = initializer.callee;
            if(callee.type !== 'Identifier' || callee.name !== 'require' || binding.path.scope.getBinding('require'))
            {
                return;
            }

            declaration = {
                initializerStart: state.map.toSource(initializer.start),
                initializerEnd: state.map.toSource(initializer.end)
            };
            identifierPath.stop();
        }
    };
    traverse(syntax, visitor);
    return declaration;
}

/**
 * @description Converts a source offset to a VS Code position without opening another document.
 * @param {string} text the source text.
 * @param {number} offset the source offset.
 * @returns {Object} the source position.
 */
function positionAt(text, offset)
{
    const before = text.slice(0, offset);
    const lines = before.split('\n');
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

/** @description Resolves known typed class members to their declaring source, including inherited imported fields. */
async function resolveMemberDefinition(languageService, state, position)
{
    const target = LgdClassMemberLookup.get(state, position);
    if(!Number.isInteger(target?.nameStart) || !Number.isInteger(target?.nameEnd))
    {
        return null;
    }

    const sourcePath = target.declaringSourcePath;
    const entry = sourcePath ? await languageService.readSourceEntry(sourcePath) : null;
    const content = sourcePath ? entry?.sourceText : state.document.getText();
    if(!content)
    {
        return null;
    }

    const range = new vscode.Range(positionAt(content, target.nameStart), positionAt(content, target.nameEnd));
    return new vscode.Location(sourcePath ? vscode.Uri.file(sourcePath) : state.document.uri, range);
}

/**
 * @description Resolves a direct imported binding or LGD type name to its exported LGD declaration.
 * Relative requires cannot resolve from untitled JavaScript mirrors, so this uses source metadata.
 * @param {Object} languageService the LGD language service.
 * @param {Object} state the source document state.
 * @param {Object} position the source cursor position.
 * @returns {Promise<Object|null>} the precise exported source location, or null.
 */
async function resolveImportedDefinition(languageService, state, position)
{
    const member = await resolveMemberDefinition(languageService, state, position);
    if(member)
    {
        return member;
    }

    const document = state.document;
    const wordRange = document.getWordRangeAtPosition(position);
    if(!wordRange)
    {
        return null;
    }

    const name = document.getText(wordRange);
    const offset = document.offsetAt(wordRange.start);
    const sourceCode = maskCode(document.getText(), true);
    if(sourceCode.slice(offset, offset + name.length) !== name)
    {
        return null;
    }

    const scopes = collectScopes(sourceCode);
    const bindings = collectBindings({ content: document.getText(), masked: sourceCode,
        declarations: state.declarations, scopes: scopes, externals: state.externals || new Map() });
    const erased = visibleBindings(bindings, offset).get(name);
    const declaredType = [ 'class', 'interface', 'enum' ].includes(erased?.kind);
    if(declaredType && (isTypeReference(state, offset, name) || offset === erased.nameStart))
    {
        const text = erased.sourceText || document.getText();
        const range = new vscode.Range(positionAt(text, erased.nameStart), positionAt(text, erased.nameEnd));
        const uri = erased.sourcePath ? vscode.Uri.file(erased.sourcePath) : document.uri;
        return new vscode.Location(uri, range);
    }

    const declaration = findRequireDeclaration(state, offset, name);
    if(!declaration)
    {
        return null;
    }

    const target = await languageService.resolveRequireTarget(document, declaration);
    if(!target)
    {
        return null;
    }

    const range = new vscode.Range(positionAt(target.sourceText, target.nameStart), positionAt(target.sourceText, target.nameEnd));
    return new vscode.Location(vscode.Uri.file(target.sourcePath), range);
}

/**
 * @description Maps any known mirror target through its own source map and keeps external locations.
 * Definition links use their selection range so navigation lands on the symbol itself.
 * @param {Object} languageService the LGD language service.
 * @param {Object} location a delegated Location or LocationLink.
 * @returns {Object|null} the mapped Location, or null for an invalid target.
 */
function mapProviderLocation(languageService, location)
{
    const uri = location.targetUri || location.uri;
    const range = location.targetSelectionRange || location.targetRange || location.range;
    if(!uri || !range)
    {
        return null;
    }

    let retiredMirror = false;
    for(const state of languageService.states.values())
    {
        if(state.jsDocument && state.jsDocument.uri.toString() === uri.toString())
        {
            if(languageService.getCurrentMirrorState(state.document) !== state)
            {
                retiredMirror = true;
                continue;
            }

            const mapped = languageService.toLgdRange(state.document.uri, range);
            return mapped ? new vscode.Location(state.document.uri, mapped) : null;
        }
    }

    return retiredMirror ? null : new vscode.Location(uri, range);
}

module.exports = { resolveImportedDefinition: resolveImportedDefinition, mapProviderLocation: mapProviderLocation };
