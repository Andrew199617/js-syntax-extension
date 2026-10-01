const LgdCompiler = require('../Compilers/LgdCompiler');

/** @description File extension for LGD language files. */
const LGD_EXT = '.lgd';

/** @description File extension for plain JavaScript files. */
const JS_EXT = '.js';

/** @description Checks whether a file name is an LGD language file. */
function isLgdFile(fileName)
{
    return typeof fileName === 'string' && fileName.endsWith(LGD_EXT);
}

/** @description Checks whether a file is a source file the typings pipeline supports. */
function isSupportedSourceFile(fileName)
{
    return typeof fileName === 'string' && (fileName.endsWith(JS_EXT) || fileName.endsWith(LGD_EXT));
}

/** @description Rewrites LGD typed declarations into JavaScript the parser pipeline understands. */
function transformLgdContent(content)
{
    if(typeof content !== 'string')
    {
        return content;
    }

    return LgdCompiler.create().compileToJs(content).code;
}

module.exports = {
    isLgdFile,
    isSupportedSourceFile,
    transformLgdContent,
    LGD_EXT,
    JS_EXT
};
