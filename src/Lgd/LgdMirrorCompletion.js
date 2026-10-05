const vscode = require('vscode');
const { maskCode } = require('../Compilers/LgdInfer');

/** @description Forwards standard JavaScript member completions while keeping all edit ranges in the LGD source. */
const LgdMirrorCompletion = {
    /** @description Completes native members, including indexed array elements, on the current compiled mirror. */
    async provide(languageService, document, position)
    {
        const source = document.getText();
        const prefix = maskCode(source.slice(0, document.offsetAt(position)), true);
        if(!(/(?:\?\.|\.)[\w$]*$/).test(prefix))
        {
            return null;
        }

        const state = languageService.getState(document.uri);
        const current = state?.document === document && state.compiledText === source && state.compiledVersion === document.version;
        if(!current || !state.jsDocument || !state.map)
        {
            return null;
        }

        const version = document.version;
        const mirror = { document: state.jsDocument, text: state.jsDocument.getText(), version: state.jsDocument.version, map: state.map };
        const mapped = languageService.toJsPosition(document.uri, position);
        const result = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', state.jsDocument.uri, mapped);
        const sameMirror = state.jsDocument === mirror.document && state.map === mirror.map;
        const sameSnapshot = mirror.document.version === mirror.version && mirror.document.getText() === mirror.text;
        const sameSource = document.version === version && document.getText() === source;
        if(!result || !sameSource || !sameMirror || !sameSnapshot || languageService.getState(document.uri) !== state)
        {
            return null;
        }

        const items = Array.isArray(result) ? result : result.items;
        return items?.map(item => this.mapItem(item, { languageService: languageService, document: document, state: state })).filter(Boolean) || null;
    },

    /** @description Rejects edits in generated comments and accepts only source-backed mirror ranges. */
    mapRange(range, context)
    {
        const { languageService, document, state } = context;
        const mapped = languageService.toLgdRange(document.uri, range);
        if(!mapped)
        {
            return null;
        }

        const start = state.jsDocument.offsetAt(range.start);
        const end = state.jsDocument.offsetAt(range.end);
        const sourceStart = document.offsetAt(mapped.start);
        const sourceEnd = document.offsetAt(mapped.end);
        const sameSpan = end - start === sourceEnd - sourceStart;
        const sameText = state.jsDocument.getText(range) === document.getText(mapped);
        const sourceBacked = state.map.toOutput(sourceStart) === start && state.map.toOutput(sourceEnd) === end;
        return sameSpan && sameText && sourceBacked ? mapped : null;
    },

    /** @description Maps a normal replacement range or the insert and replace ranges of one completion. */
    mapItemRange(range, context)
    {
        if(range.inserting && range.replacing)
        {
            const inserting = this.mapRange(range.inserting, context);
            const replacing = this.mapRange(range.replacing, context);
            return inserting && replacing ? { inserting: inserting, replacing: replacing } : null;
        }

        return this.mapRange(range, context);
    },

    /** @description Maps normal TextEdits and insert/replace edit representations without changing the replacement text. */
    mapEdit(edit, context)
    {
        if(edit.range)
        {
            const range = this.mapRange(edit.range, context);
            return range ? { ...edit, range: range } : null;
        }

        if(edit.insert && edit.replace)
        {
            const insert = this.mapRange(edit.insert, context);
            const replace = this.mapRange(edit.replace, context);
            return insert && replace ? { ...edit, insert: insert, replace: replace } : null;
        }

        return null;
    },

    /** @description Copies provider metadata and translates every supported edit before returning a completion. */
    mapItem(item, context)
    {
        const mapped = Object.assign(new vscode.CompletionItem(item.label, item.kind), item);
        if(item.range)
        {
            mapped.range = this.mapItemRange(item.range, context);
            if(!mapped.range)
            {
                return null;
            }
        }

        if(item.textEdit)
        {
            mapped.textEdit = this.mapEdit(item.textEdit, context);
            if(!mapped.textEdit)
            {
                return null;
            }
        }

        if(item.additionalTextEdits)
        {
            mapped.additionalTextEdits = [];
            for(const edit of item.additionalTextEdits)
            {
                const mappedEdit = this.mapEdit(edit, context);
                if(!mappedEdit)
                {
                    return null;
                }

                mapped.additionalTextEdits.push(mappedEdit);
            }
        }

        // Completion commands may contain generated-file edits that cannot be mapped safely.
        if(item.command)
        {
            delete mapped.command;
        }

        return mapped;
    }
};

module.exports = LgdMirrorCompletion;
