const vscode = require('vscode');
const { parse } = require('@babel/parser');

/** @description Concrete type syntax that can be compared without resolving aliases or weakening types. */
const primitiveTypes = new Set([
    'TSNumberKeyword',
    'TSStringKeyword',
    'TSBooleanKeyword',
    'TSBigIntKeyword',
    'TSSymbolKeyword',
    'TSObjectKeyword',
    'TSVoidKeyword',
    'TSUndefinedKeyword',
    'TSNullKeyword',
    'TSNeverKeyword'
]);

/** @description Removes only type-only hover documentation already stated by the visible signature. */
const LgdHoverDocumentation = {
    /** @description Preserves hover objects and metadata while filtering a provably redundant type paragraph. */
    deduplicate(contents)
    {
        const entries = Array.isArray(contents) ? contents : [contents];
        const type = this._signatureType(entries[0]);
        if(!type)
        {
            return contents;
        }

        let changed = false;
        const filtered = [];
        for(const entry of entries)
        {
            if(entry?.language || typeof entry !== 'string' && typeof entry?.value !== 'string')
            {
                filtered.push(entry);
                continue;
            }

            const text = typeof entry === 'string' ? entry : entry.value;
            const cleaned = this._removeTypeParagraph(text, type);
            if(cleaned === text)
            {
                filtered.push(entry);
                continue;
            }

            changed = true;
            if(!cleaned.trim())
            {
                continue;
            }

            if(typeof entry === 'string')
            {
                filtered.push(cleaned);
            }
            else
            {
                const replacement = new vscode.MarkdownString(cleaned, entry.supportThemeIcons);
                replacement.isTrusted = entry.isTrusted;
                replacement.baseUri = entry.baseUri;
                replacement.supportHtml = entry.supportHtml;
                if('supportAlertSyntax' in entry && 'supportAlertSyntax' in replacement)
                {
                    replacement.supportAlertSyntax = entry.supportAlertSyntax;
                }

                filtered.push(replacement);
            }
        }

        if(!changed)
        {
            return contents;
        }

        return Array.isArray(contents) ? filtered : filtered[0];
    },

    _signatureType(entry)
    {
        let signature;
        if(entry?.language === 'typescript' || entry?.language === 'javascript')
        {
            signature = entry.value;
        }
        else
        {
            const text = typeof entry === 'string' ? entry : entry?.value;
            const block = typeof text === 'string' && (/^\s*```(?:typescript|javascript)\r?\n(?<signature>[\S\s]*?)\r?\n```/).exec(text);
            signature = block?.groups.signature;
        }

        if(!signature)
        {
            return null;
        }

        const match = (/^(?:\(alias\)\s+)?(?:(?:const|let|var)\s+[\w$]+|\(property\)\s+(?:readonly\s+)?[\w$.?]+):\s*(?<type>[\S\s]+?)(?:\r?\nimport\s+[^\n\r]+)?$/).exec(signature);
        return match ? this._typeKey(match.groups.type) : null;
    },

    _removeTypeParagraph(text, signatureType)
    {
        const chunks = text.split(/(?<separator>\r?\n[\t ]*\r?\n)/);
        let fence = '';
        for(let index = 0; index < chunks.length; index += 2)
        {
            const paragraph = chunks[index];
            const wasFenced = Boolean(fence);
            const fences = [...paragraph.matchAll(/^ {0,3}(?<fence>`{3,}|~{3,})/gm)];
            for(const match of fences)
            {
                const marker = match.groups.fence;
                if(!fence)
                {
                    fence = marker;
                }
                else if(marker[0] === fence[0] && marker.length >= fence.length)
                {
                    fence = '';
                }
            }

            if(wasFenced || fences.length > 0 || (/^(?: {4}|\t)/m).test(paragraph))
            {
                continue;
            }

            const tag = (/^\s*(?:\*@type\*|\*\*@type\*\*|@type)\s*(?:[–—-]\s*)?(?<code>`?){(?<type>[\S\s]+)}\k<code>\s*$/).exec(paragraph);
            if(tag && this._typeKey(tag.groups.type) === signatureType)
            {
                chunks[index] = '';
                if(index > 0)
                {
                    chunks[index - 1] = '';
                }
                else if(index + 1 < chunks.length)
                {
                    chunks[index + 1] = '';
                }
            }
        }

        return chunks.join('');
    },

    _typeKey(text)
    {
        try
        {
            const syntax = parse(`type HoverType = ${text};`, { plugins: ['typescript'] });
            const statements = syntax.program.body;
            if(syntax.comments.length > 0 || statements.length !== 1 || statements[0].type !== 'TSTypeAliasDeclaration')
            {
                return null;
            }

            return this._nodeKey(statements[0].typeAnnotation);
        }
        catch
        {
            return null;
        }
    },

    _nodeKey(node)
    {
        if(primitiveTypes.has(node.type))
        {
            return node.type;
        }

        if(node.type === 'TSParenthesizedType')
        {
            return this._nodeKey(node.typeAnnotation);
        }

        if(node.type === 'TSArrayType')
        {
            const element = this._nodeKey(node.elementType);
            return element ? `array(${element})` : null;
        }

        if(node.type === 'TSUnionType' || node.type === 'TSTypeReference')
        {
            const children = node.type === 'TSUnionType' ? node.types : node.typeParameters?.params || [];
            const keys = children.map(child => this._nodeKey(child));
            if(keys.some(key => !key))
            {
                return null;
            }

            if(node.type === 'TSUnionType')
            {
                return `union(${keys.sort().join(',')})`;
            }

            const name = this._referenceName(node.typeName);
            return name ? `reference(${name}<${keys.join(',')}>)` : null;
        }

        // Any/unknown, Closure syntax, expanded aliases and complex types lack safe equivalence evidence.
        return null;
    },

    _referenceName(node)
    {
        if(node.type === 'Identifier')
        {
            return node.name;
        }

        if(node.type === 'TSQualifiedName')
        {
            const left = this._referenceName(node.left);
            return left ? `${left}.${node.right.name}` : null;
        }

        return null;
    }
};

module.exports = LgdHoverDocumentation;
