/**
 * Preprocessing for LGD language files (.lgd).
 *
 * LGD files declare variables C#-style (`Number count = 0;`) instead of
 * `const count = 0;` with a `@type` tag above it. Typed declarations are not
 * valid JavaScript, so they are rewritten to `let`/`const` with a synthetic
 * `@type` comment before the existing parser pipeline runs. The pipeline then
 * honors the declared type exactly like a hand-written `@type` tag, so LGD
 * source never needs `@type` above a typed declaration.
 *
 * Only variable declaration statements are rewritten. Object literal
 * properties keep the existing `name: value` syntax.
 */

/** @description File extension for LGD language files. */
const LGD_EXT = '.lgd';

/** @description File extension for plain JavaScript files. */
const JS_EXT = '.js';

/** @description Maps each LGD type keyword to its TypeScript type. */
const typeKeywordToTsType = {
    Number: 'number',
    String: 'string',
    Boolean: 'boolean',
    BigInt: 'bigint',
    Symbol: 'symbol',
    Object: 'Object',
    Array: 'any[]',
    Function: 'Function'
};

/**
 * @description Matches one LGD typed declaration statement, e.g. `readonly Number count = 0;`.
 * The initializer may span lines but may not contain an unquoted semicolon.
 */
const typedDeclarationPattern = /^(?<indent>[ \t]*)(?<exportKeyword>export[ \t]+)?(?<readonlyKeyword>readonly[ \t]+)?(?<typeKeyword>Number|String|Boolean|BigInt|Symbol|Object|Array|Function)[ \t]+(?<variableName>[A-Za-z_$][\w$]*)(?<assignment>[ \t]*=[ \t]*[^;]+)?;/gm;

/**
 * @description Rewrites one typed declaration into let/const with a synthetic @type tag.
 * @param {...*} replacerArgs the String.replace replacer arguments; the last one holds the named groups.
 * @returns {string} the rewritten declaration.
 */
function replaceTypedDeclaration(...replacerArgs)
{
    const groups = replacerArgs[replacerArgs.length - 1];
    const tsType = typeKeywordToTsType[groups.typeKeyword];
    const declarationKind = groups.readonlyKeyword ? 'const' : 'let';
    const exportKeyword = groups.exportKeyword || '';
    const assignment = groups.assignment || '';

    return `${groups.indent}/** @type {${tsType}} */\n${groups.indent}${exportKeyword}${declarationKind} ${groups.variableName}${assignment};`;
}

/**
 * @description Checks whether a file is an LGD language file.
 * @param {string} fileName the file name to check.
 * @returns {boolean} true when the file name ends with .lgd.
 */
function isLgdFile(fileName)
{
    return typeof fileName === 'string' && fileName.endsWith(LGD_EXT);
}

/**
 * @description Checks whether a file can be compiled into typings.
 * @param {string} fileName the file name to check.
 * @returns {boolean} true for .js and .lgd files.
 */
function isSupportedSourceFile(fileName)
{
    return typeof fileName === 'string' && (fileName.endsWith(JS_EXT) || fileName.endsWith(LGD_EXT));
}

/**
 * @description Rewrites LGD typed declarations into JavaScript the parser pipeline understands.
 * @param {string} content the raw .lgd file content.
 * @returns {string} the content with typed declarations rewritten.
 */
function transformLgdContent(content)
{
    if(typeof content !== 'string')
    {
        return content;
    }

    return content.replace(typedDeclarationPattern, replaceTypedDeclaration);
}

module.exports = {
    isLgdFile,
    isSupportedSourceFile,
    transformLgdContent
};
