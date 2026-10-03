const parser = require('@babel/parser');
const { tsTypeMap } = require('./LgdTypeMaps');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('./LgdInfer');
const LgdEnumSyntax = require('./LgdEnumSyntax');

/** @description Converts explicitly selected, proven frozen enum objects without inventing types for ordinary objects. */
const LgdEnumConversion = {
    /** @description Converts only named const declarations with literal frozen values; unselected or uncertain objects remain untouched. */
    toLgd(content, names = [])
    {
        const requested = new Set(names);
        const converted = [];
        const skipped = [];
        const edits = [];
        let tree;
        try
        {
            tree = parser.parse(content, { sourceType: 'unambiguous' });
        }
        catch(error)
        {
            return { code: content, converted: converted, skipped: [...requested], errors: [error.message] };
        }

        if(this.hasUncertainNative(tree))
        {
            return { code: content, converted: [], skipped: [...requested], errors: [] };
        }

        const masked = maskCode(content, true);
        traverse(tree, {
            /** @description Recognizes the exact runtime form emitted by the LGD enum compiler. */
            VariableDeclaration: path =>
            {
                if(path.node.declarations.length !== 1 || path.node.kind !== 'const')
                {
                    return;
                }

                const variable = path.node.declarations[0];
                if(variable.id.type !== 'Identifier' || !requested.has(variable.id.name))
                {
                    return;
                }

                const owner = path.parentPath.isExportNamedDeclaration() ? path.parentPath : path;
                const lineStart = content.lastIndexOf('\n', owner.node.start - 1) + 1;
                const name = variable.id.name;
                if(content.slice(lineStart, owner.node.start).trim() || Object.hasOwn(tsTypeMap, name))
                {
                    skipped.push(name);
                    return;
                }

                const values = this.members(variable.init, content);
                if(!values || path.scope.getBinding('Object'))
                {
                    skipped.push(name);
                    return;
                }

                const initializer = variable.init;
                const object = initializer.arguments[0];
                const plainHead = (/^const\s+$/).test(content.slice(path.node.start, variable.id.start));
                const plainWrapper = (/^\s*=\s*Object\.freeze\(\s*$/).test(content.slice(variable.id.end, object.start));
                const plainTail = (/^\s*\)\s*;?$/).test(content.slice(object.end, path.node.end));
                if(!plainHead || !plainWrapper || !plainTail)
                {
                    skipped.push(name);
                    return;
                }

                const binding = path.scope.getBinding(name);
                if(!binding || !binding.constant)
                {
                    skipped.push(name);
                    return;
                }

                edits.push({ start: path.node.start, end: variable.id.start, text: 'enum ' });
                edits.push({ start: variable.id.end, end: object.start, text: ' ' });
                edits.push({ start: object.end, end: path.node.end, text: '' });
                for(const property of object.properties)
                {
                    const colon = masked.indexOf(':', property.key.end);
                    edits.push({ start: colon, end: colon + 1, text: '=' });
                }

                const alias = `/** @typedef {typeof ${name}[keyof typeof ${name}]} ${name} */`;
                const comments = owner.node.leadingComments || [];
                const generated = comments.find(comment => content.slice(comment.start, comment.end) === alias);
                if(generated)
                {
                    const ending = content.startsWith('\r\n', generated.end) ? '\r\n' : '\n';
                    const end = content.startsWith(ending, generated.end) ? generated.end + ending.length : generated.end;
                    edits.push({ start: generated.start, end: end, text: '' });
                }

                converted.push(name);
            }
        });
        let code = content;
        for(const edit of edits.sort((first, second) => second.start - first.start))
        {
            code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
        }

        for(const name of requested)
        {
            if(!converted.includes(name) && !skipped.includes(name))
            {
                skipped.push(name);
            }
        }

        return { code: code, converted: converted, skipped: skipped, errors: [] };
    },

    /** @description Preserves source when native Object is replaced, mutated, or exposed through an unknown alias. */
    hasUncertainNative(tree)
    {
        let uncertain = false;
        traverse(tree, {
            /** @description Identifies unshadowed native receivers without following arbitrary user code. */
            Identifier: path =>
            {
                const nativeObject = path.node.name === 'Object' && !path.scope.getBinding('Object');
                const globalObject = [ 'globalThis', 'global', 'window', 'self' ].includes(path.node.name) && !path.scope.getBinding(path.node.name);
                if(!nativeObject && !globalObject || !path.isReferencedIdentifier() && !path.isBindingIdentifier())
                {
                    return;
                }

                const receiver = path.parentPath;
                const nativeMember = nativeObject && receiver.isMemberExpression() && !receiver.node.computed && receiver.node.object === path.node;
                const directCall = nativeMember && receiver.parentPath.isCallExpression() && receiver.parentPath.node.callee === receiver.node;
                if(!directCall)
                {
                    uncertain = true;
                    path.stop();
                }
            }
        });
        return uncertain;
    },

    /** @description Accepts only plain identifier keys and homogeneous literal values in Object.freeze. */
    members(initializer, content)
    {
        if(initializer?.type !== 'CallExpression' || initializer.arguments.length !== 1 || initializer.optional)
        {
            return null;
        }

        const callee = initializer.callee;
        const plainReceiver = callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier';
        if(!plainReceiver || callee.object.name !== 'Object' || callee.property.name !== 'freeze')
        {
            return null;
        }

        const object = initializer.arguments[0];
        if(object.type !== 'ObjectExpression')
        {
            return null;
        }

        const names = new Set();
        let typeName;
        for(const property of object.properties)
        {
            const plainProperty = property.type === 'ObjectProperty' && !property.computed && !property.shorthand && property.key.type === 'Identifier';
            if(!plainProperty || property.key.name === '__proto__' || names.has(property.key.name))
            {
                return null;
            }

            const literal = LgdEnumSyntax.literal(content.slice(property.value.start, property.value.end));
            if(!literal || typeName && literal.typeName !== typeName)
            {
                return null;
            }

            names.add(property.key.name);
            typeName = literal.typeName;
        }

        return names;
    }
};

module.exports = LgdEnumConversion;
