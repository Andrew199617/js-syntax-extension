const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdSourceMap = require('../../Compilers/LgdSourceMap');
const { tsTypeMap } = require('../../Compilers/LgdTypeMaps');

/** @description Suggests one conservative parameter-contract edit after validating the exact assignment and preview. */
class ChangeParameterTypeFix extends DiagnosticQuickFix
{
    constructor() { super('changeParameterType'); }

    /** @description Rechecks compiler provenance, caller isolation, and all diagnostics before offering an annotation-only edit. */
    async createProposal(context, fix)
    {
        const { source, snapshots, document, state, languageService } = context;
        if(fix.oldTypeName !== 'Number' || fix.newTypeName !== 'String' || source.text.slice(fix.offset, fix.endOffset) !== 'Number')
        {
            return null;
        }

        const compiler = LgdCompiler.create();
        const options = await languageService.getOutputOptions(document);
        const original = compiler.compileToJs(source.text, state.externals, options);
        const diagnostic = original.errors.find(error =>
        {
            const sameAssignment = error.offset === fix.assignmentStart && error.endOffset === fix.assignmentEnd;
            return error.code === 'lgd.assignment.typeMismatch' && sameAssignment;
        });

        if(!diagnostic?.quickFix || !this._sameFix(diagnostic.quickFix, fix))
        {
            return null;
        }

        const declaration = original.allDeclarations.find(candidate => candidate.headStart === fix.declarationStart);
        const groups = [ ...declaration?.typedParams ? [declaration.typedParams] : [], ...declaration?.methodTypedParams || [] ];
        const group = groups.find(candidate => candidate.start === fix.groupStart);
        if(!declaration || !group || !this._isolatedSignature(original, declaration, group))
        {
            return null;
        }

        if(!this._isolatedDocument(document, languageService) || this._hasReferences(original, declaration, source.text))
        {
            return null;
        }

        const previewText = `${source.text.slice(0, fix.offset)}String${source.text.slice(fix.endOffset)}`;
        const preview = compiler.compileToJs(previewText, state.externals, options);
        const remainingTarget = preview.errors.some(error =>
        {
            const sameSpan = error.offset === diagnostic.offset && error.endOffset === diagnostic.endOffset;
            return error.code === diagnostic.code && sameSpan;
        });

        if(remainingTarget || !this._preservesDiagnostics(original.errors, preview.errors))
        {
            return null;
        }

        let title = `Change parameter '${fix.parameterName}' to String (changes signature)`;
        if(preview.errors.length > 0)
        {
            const count = preview.errors.length;
            const noun = count === 1 ? 'diagnostic remains' : 'diagnostics remain';
            title += `; ${count} existing ${noun}`;
        }

        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'String',
            validate: () => this._isolatedDocument(document, languageService) };
    }

    /** @description Requires every source identity field to agree with a fresh lexical compiler analysis. */
    _sameFix(current, requested)
    {
        const fields = [ 'kind',
            'declarationStart',
            'groupStart',
            'parameterName',
            'parameterOffset',
            'offset',
            'endOffset',
            'oldTypeName',
            'newTypeName',
            'assignmentStart',
            'assignmentEnd' ];

        return fields.every(field => current[field] === requested[field]);
    }

    /** @description Withholds automatic edits for public, inherited, interface, constructor, or unresolved contracts. */
    _isolatedSignature(result, declaration, group)
    {
        const plainOwner = declaration.kind === 'class' || [ 'Function', 'Object' ].includes(declaration.typeName);
        const member = declaration.classMembers?.find(candidate => candidate.name === group.name);
        const documentedFunction = declaration.typedParams && (/@(?:param|type|callback|typedef|returns?)\b/).test(declaration.jsdoc || '');
        if(documentedFunction)
        {
            return false;
        }

        const publicOwner = declaration.exported || declaration.abstract || declaration.kind === 'interface';
        const inheritedOwner = declaration.baseName || declaration.heritage?.length > 0 || declaration.interfaceNames?.length > 0;
        const inheritedMethod = declaration.inheritedMethodContracts?.length > 0 || member?.virtual || member?.override;
        const unsupportedMember = member?.isConstructor || member?.abstract || group.accessor || group.generator || group.abstract;
        const unresolvedReturn = group.returnTypeName && group.returnTypeName !== 'void' && !Object.hasOwn(tsTypeMap, group.returnTypeName);
        if(!plainOwner || publicOwner || inheritedOwner || inheritedMethod || unsupportedMember || unresolvedReturn)
        {
            return false;
        }

        return !result.allDeclarations.some(candidate =>
        {
            function referencesType(type)
            {
                return type === declaration.name || type?.startsWith(`${declaration.name}.`);
            }

            const groups = [ ...candidate.typedParams ? [candidate.typedParams] : [], ...candidate.methodTypedParams || [] ];
            const signatureReference = groups.some(signature => referencesType(signature.returnTypeName) || signature.params.some(parameter => referencesType(parameter.typeName)));
            const propertyReference = candidate.classMembers?.some(property => referencesType(property.propertyTypeName));
            if(signatureReference || propertyReference)
            {
                return true;
            }

            if(candidate === declaration)
            {
                return false;
            }

            const inheritedReference = candidate.heritage?.some(base => base.name === declaration.name);
            return candidate.typeName === declaration.name || candidate.baseName === declaration.name || inheritedReference;
        });
    }

    /** @description Rejects known consumers instead of assuming the currently visible file owns all callers. */
    _isolatedDocument(document, languageService)
    {
        if(languageService.dependents.get(document.uri.fsPath)?.size > 0)
        {
            return false;
        }

        for(const state of languageService.states.values())
        {
            if(state.document === document)
            {
                continue;
            }

            if(Array.from(state.externals?.values() || []).some(entry => entry.sourcePath === document.uri.fsPath))
            {
                return false;
            }
        }

        return true;
    }

    /** @description Resolves references by lexical identity and rejects calls, exports, escapes, and dynamic receiver access. */
    _hasReferences(result, declaration, source)
    {
        // Source JSDoc can create typed callers that disappear from JavaScript's lexical binding table.
        for(const comment of source.matchAll(/\/\*\*[\S\s]*?\*\//g))
        {
            const names = comment[0].match(/[$A-Z_a-z][\w$]*/g) || [];
            if(names.includes(declaration.name))
            {
                return true;
            }
        }

        const map = LgdSourceMap.create(result.mappings);
        const tree = parser.parse(result.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        let binding;
        let uncertain = false;
        traverse(tree, {
            /** @description Finds the exact declaration binding in either JavaScript output model. */
            Identifier: path =>
            {
                if([ 'eval', 'Function' ].includes(path.node.name) && path.isReferencedIdentifier())
                {
                    uncertain = true;
                }

                const offset = map.toSource(path.node.start);
                const insideOwner = declaration.initializerStart < offset && offset < declaration.initializerEnd;
                if(path.node.name === 'arguments' && path.isReferencedIdentifier() && insideOwner)
                {
                    uncertain = true;
                }

                const sameName = path.node.name === declaration.name && path.isBindingIdentifier();
                if(sameName && map.toSource(path.node.start) === declaration.nameStart)
                {
                    binding = path.scope.getBinding(declaration.name);
                }
            },

            /** @description Rejects user-written receiver access while ignoring generated factory scaffolding. */
            ThisExpression: path =>
            {
                const offset = map.toSource(path.node.start);
                const segment = map.byOutput.find(candidate => candidate.outStart <= path.node.start && path.node.start < candidate.outEnd);
                const insideOwner = declaration.initializerStart < offset && offset < declaration.initializerEnd;
                if(segment?.verbatim && insideOwner)
                {
                    uncertain = true;
                }
            },

            /** @description Rejects reflective self-reference through anonymous-function new.target. */
            MetaProperty: path =>
            {
                const offset = map.toSource(path.node.start);
                if(declaration.initializerStart < offset && offset < declaration.initializerEnd)
                {
                    uncertain = true;
                }
            },

            /** @description Rejects dynamic evaluation accessed through a property rather than an identifier. */
            MemberExpression: path =>
            {
                const property = path.node.property;
                const name = path.node.computed ? property.value : property.name;
                if([ 'eval', 'Function' ].includes(name))
                {
                    uncertain = true;
                }
            },

            /** @description Withholds edits when dynamic scope prevents exhaustive lexical reference analysis. */
            WithStatement: () =>
            {
                uncertain = true;
            }
        });
        if(!binding || uncertain || binding.constantViolations.length > 0)
        {
            return true;
        }

        // Synthetic factory references map to the declaration name, while user references retain their own spans.
        return binding.referencePaths.some(reference => map.toSource(reference.node.start) !== declaration.nameStart);
    }

    /** @description Allows only existing diagnostic identities to survive the preview; this equal-length edit preserves their offsets. */
    _preservesDiagnostics(original, preview)
    {
        const remaining = original.slice();
        for(const error of preview)
        {
            const index = remaining.findIndex(previous =>
            {
                const sameSpan = previous.offset === error.offset && previous.endOffset === error.endOffset;
                const sameMessage = previous.message === error.message && previous.severity === error.severity;
                return previous.code === error.code && sameSpan && sameMessage;
            });

            if(index === -1)
            {
                return false;
            }

            remaining.splice(index, 1);
        }

        return true;
    }
}

module.exports = ChangeParameterTypeFix;
