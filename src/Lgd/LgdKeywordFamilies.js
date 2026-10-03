/** @description Theme-facing keyword families; these roles do not grant syntax or backend support. */
const families = Object.freeze({
    control: { tokenType: 'keyword', scope: 'keyword.control.lgd', words: [] },
    declaration: { tokenType: 'lgdDeclarationKeyword', scope: 'storage.type.lgd',
        words: [ 'class', 'interface', 'enum', 'function', 'const', 'let', 'var', 'using' ] },
    modifier: { tokenType: 'lgdModifierKeyword', scope: 'storage.modifier.lgd',
        words: [ 'abstract', 'async', 'extends', 'override', 'private', 'protected', 'public', 'readonly', 'sealed', 'static', 'virtual' ] },
    builtin: { tokenType: 'lgdTypeKeyword', scope: 'keyword.type.lgd', words: ['void'] },
    expression: { tokenType: 'lgdExpressionKeyword', scope: 'variable.language.lgd', words: [ 'base', 'this', 'new' ] }
});

/** @description Shared vocabulary for source semantic tokens and checked TextMate/manifest fallback scopes. */
const LgdKeywordFamilies = {
    families: families,
    tokenTypes: Object.values(families).map(family => family.tokenType),

    /** @description Resolves a parsed syntax word, leaving ordinary identifiers to the caller's context checks. */
    get(word)
    {
        return Object.values(families).find(family => family.words.includes(word)) || families.control;
    }
};

module.exports = LgdKeywordFamilies;
