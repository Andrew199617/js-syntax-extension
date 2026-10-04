/** @description Cleanup preferences are independent opt-ins; unsupported destructive cleanups have no aliases. */
const LgdCleanupStyleOptions = {
    catalog: {
        id: 'lgd.format.cleanup', title: 'Safe cleanup',
        defaults: { unusedLocals: 'preserve', unreachableStatements: 'preserve' },
        properties: {
            unusedLocals: { enum: [ 'preserve', 'remove' ] },
            unreachableStatements: { enum: [ 'preserve', 'remove' ] }
        }
    },
    editorConfig: {},
    diagnosticAliases: { IDE0035: 'unreachableStatements' }
};

module.exports = LgdCleanupStyleOptions;
