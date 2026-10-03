const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdSourceMap = require('../../Compilers/LgdSourceMap');
const LgdReturnChecker = require('../../Compilers/LgdReturnChecker');
const { tsTypeMap, baseTypeName } = require('../../Compilers/LgdTypeMaps');

/** @description Shares closed-signature and speculative-compilation guards across explicit type-change strategies. */
class SignatureTypeFix extends DiagnosticQuickFix
{
    /** @description Recompiles exact source metadata and resolves the original parsed signature. */
    async _analyze(context, fix, diagnosticIdentity)
    {
        const { source, document, state, languageService } = context;
        const { code, spanFields, identityFields } = diagnosticIdentity;
        if(fix.oldTypeName !== 'Number' || fix.newTypeName !== 'String' || source.text.slice(fix.offset, fix.endOffset) !== 'Number')
        {
            return null;
        }

        const compiler = LgdCompiler.create();
        const options = await languageService.getOutputOptions(document);
        const original = compiler.compileToJs(source.text, state.externals, options);
        const diagnostic = original.errors.find(error =>
        {
            const sameSpan = error.offset === fix[spanFields[0]] && error.endOffset === fix[spanFields[1]];
            const sameMetadata = error.quickFix && identityFields.every(field => error.quickFix[field] === fix[field]);
            return error.code === code && sameSpan && sameMetadata;
        });

        if(!diagnostic)
        {
            return null;
        }

        const declaration = original.allDeclarations.find(candidate => candidate.headStart === fix.declarationStart);
        const group = this._findGroup(declaration, fix.groupStart);
        if(!declaration || !group || !this._isolatedSignature(original, declaration, group))
        {
            return null;
        }

        const closedOwner = this._closedOwner(original, declaration);
        if(!closedOwner || !this._isolatedDocument(document, languageService) || this._hasReferences(original, declaration, source.text))
        {
            return null;
        }

        return { compiler: compiler, options: options, original: original, diagnostic: diagnostic, declaration: declaration, group: group };
    }

    /** @description Finds a parsed function or method group by its exact source start. */
    _findGroup(declaration, groupStart)
    {
        const groups = [ ...declaration?.typedParams ? [declaration.typedParams] : [], ...declaration?.methodTypedParams || [] ];
        return groups.find(candidate => candidate.start === groupStart);
    }

    /** @description Requires the linked diagnostic to disappear without introducing any new diagnostic identity. */
    _validPreview(analysis, preview)
    {
        const diagnostic = analysis.diagnostic;
        const remainingTarget = preview.errors.some(error =>
        {
            const sameSpan = error.offset === diagnostic.offset && error.endOffset === diagnostic.endOffset;
            return error.code === diagnostic.code && sameSpan;
        });

        return !remainingTarget && this._preservesDiagnostics(analysis.original.errors, preview.errors);
    }

    /** @description Prevents a supposedly complete contract fix from retaining assignment or return mismatches in that method. */
    _signatureTypeErrors(preview, analysis)
    {
        const start = analysis.declaration.initializerStart + analysis.group.methodStart;
        const end = analysis.declaration.initializerStart + analysis.group.bodyEnd;
        return preview.errors.some(error =>
        {
            const signatureMismatch = [ 'lgd.assignment.typeMismatch', 'lgd.return.typeMismatch' ].includes(error.code);
            return signatureMismatch && start <= error.offset && error.offset <= end;
        });
    }

    /** @description Requires module privacy or a genuinely nested lexical owner before changing any signature contract. */
    _closedOwner(result, declaration)
    {
        const tree = parser.parse(result.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        const map = LgdSourceMap.create(result.mappings);
        let closed = false;
        traverse(tree, {
            /** @description Finds the owner binding and distinguishes local/module declarations from global script bindings. */
            Identifier: path =>
            {
                const ownerName = path.node.name === declaration.name && path.isBindingIdentifier();
                if(ownerName && map.toSource(path.node.start) === declaration.nameStart)
                {
                    const binding = path.scope.getBinding(declaration.name);
                    closed = binding && (!binding.scope.path.isProgram() || tree.program.sourceType === 'module');
                }
            }
        });
        return closed;
    }

    /** @description Independently proves every reachable return is String; unknown compiler-compatible values are insufficient. */
    _stringReturns(result, fix, source, externals)
    {
        const declaration = result.allDeclarations.find(candidate => candidate.headStart === fix.declarationStart);
        const group = this._findGroup(declaration, fix.groupStart);
        if(!declaration || !group)
        {
            return false;
        }

        const emitted = { code: result.code, segments: result.mappings };
        const context = LgdReturnChecker.createContext(source, result.allDeclarations, emitted, { externals: externals });
        const signature = context.signatures.find(candidate => candidate.declaration === declaration && candidate.group === group);
        let proved = false;
        traverse(context.tree, {
            /** @description Checks the source-mapped method rather than generated factories or nested functions. */
            Function: path =>
            {
                const bodyStart = context.map.toOutput(declaration.initializerStart + group.bodyStart);
                if(signature && path.node.body.start === bodyStart)
                {
                    proved = LgdReturnChecker.returnsOnly(path, signature, context, 'String');
                }
            }
        });
        return proved;
    }

    /** @description Discloses unrelated existing diagnostics on an explicit, unpreferred contract-changing action. */
    _titleWithRemaining(title, preview)
    {
        if(preview.errors.length === 0)
        {
            return title;
        }

        const count = preview.errors.length;
        const noun = count === 1 ? 'diagnostic remains' : 'diagnostics remain';
        return `${title}; ${count} existing ${noun}`;
    }

    /** @description Withholds automatic edits for public, inherited, interface, constructor, or unresolved contracts. */
    _isolatedSignature(result, declaration, group)
    {
        const plainOwner = declaration.kind === 'class' || [ 'Function', 'Object' ].includes(declaration.typeName);
        const member = declaration.classMembers?.find(candidate => candidate.name === group.name);
        const documentedFunction = (/@(?:param|type|callback|typedef|returns?)\b/).test(declaration.jsdoc || '');
        if(documentedFunction)
        {
            return false;
        }

        const publicOwner = declaration.exported || declaration.abstract || declaration.kind === 'interface';
        const inheritedOwner = declaration.baseName || declaration.heritage?.length > 0 || declaration.interfaceNames?.length > 0;
        const inheritedMethod = declaration.inheritedMethodContracts?.length > 0 || member?.virtual || member?.override;
        const defaultOrRest = group.params.some(parameter => parameter.rest || parameter.defaultText !== null);
        const unsupportedMember = member?.isConstructor || member?.abstract || group.accessor || group.generator || group.abstract || group.async || defaultOrRest;
        const unresolvedReturn = group.returnTypeName && group.returnTypeName !== 'void' && !Object.hasOwn(tsTypeMap, group.returnTypeName);
        if(!plainOwner || publicOwner || inheritedOwner || inheritedMethod || unsupportedMember || unresolvedReturn)
        {
            return false;
        }

        return !result.allDeclarations.some(candidate =>
        {
            function referencesType(type)
            {
                return baseTypeName(type) === declaration.name || type?.startsWith(`${declaration.name}.`);
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
            return baseTypeName(candidate.typeName) === declaration.name || candidate.baseName === declaration.name || inheritedReference;
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
            const insideOwner = declaration.headStart <= comment.index && comment.index < declaration.initializerEnd;
            const documentedContract = insideOwner && (/@(?:param|type|callback|typedef|returns?)\b/).test(comment[0]);
            if(names.includes(declaration.name) || documentedContract)
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
        const lexicalOwner = binding && (binding.path.isVariableDeclarator() || binding.path.isClassDeclaration());
        const variable = binding?.path.findParent(path => path.isVariableDeclaration());
        const globalVariable = variable?.node.kind === 'var';
        if(!lexicalOwner || globalVariable || uncertain || binding.constantViolations.length > 0)
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

module.exports = SignatureTypeFix;
