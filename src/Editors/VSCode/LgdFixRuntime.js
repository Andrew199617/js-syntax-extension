const LgdFixEngine = require('../../Lgd/Fixes/LgdFixEngine');
const QuickFixContext = require('../../Lgd/QuickFixes/QuickFixContext');
const createQuickFixRegistry = require('../../Lgd/QuickFixes/QuickFixRegistry');

/** @description Supplies the VS Code document adapter to the editor-neutral rule engine. */
const LgdFixRuntime = {
    /** @description Creates a fix runtime using current VS Code source buffers and dependency snapshots. */
    create(languageService)
    {
        return LgdFixEngine.create(languageService, {
            handlers: createQuickFixRegistry(),
            createContext: (document, state) => new QuickFixContext(languageService, document, state)
        });
    }
};

module.exports = LgdFixRuntime;
