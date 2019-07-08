const  mkpath = require('mkpath');
const  path = require('path');
const extend = require('extend');
const  fs = require('fs');
const  vscode = require('vscode');

const FileParser = require("./FileParser");

const DEFAULT_EXT = ".d.ts";
const DEFAULT_DIR = "typings"

// compile the given less file
async function compile(jsFile, content)
{
    const typeFile = FileParser.parse(content);
    
    const baseFilename = path.parse(jsFile).name;
    const typeFilePath = `${vscode.workspace.rootPath}\\${DEFAULT_DIR}\\${baseFilename}${DEFAULT_EXT}`;

    await writeFileContents(typeFilePath, typeFile);
    return;

}

function intepolatePath(path)
{
    return (path).replace(/\$\{workspaceRoot\}/g, vscode.workspace.rootPath);
}

// writes a file's contents in a path where directories may or may not yet exist
function writeFileContents(filepath, content)
{
    return new Promise((resolve, reject) =>
    {
        mkpath(path.dirname(filepath), err =>
        {
            if (err)
            {
                return reject(err);
            }

            fs.writeFile(filepath, content, err =>
            {
                if (err)
                {
                    reject(err)
                }
                else
                {
                    resolve()
                }
            });
        });
    });
}

function readFilePromise(filename, encoding)
{
    return new Promise((resolve, reject) =>
    {
        fs.readFile(filename, encoding, (err, data) =>
        {
            if (err) 
            {
                reject(err)
            }
            else
            {
                resolve(data);
            }
        });
    });
}

function chooseExtension(options)
{
    if (options && options.outExt)
    {
        if (options.outExt === "")
        {
            // special case for no extension (no idea if anyone would really want this?)
            return "";
        }

        return ensureDotPrefixed(options.outExt) || DEFAULT_EXT;
    }

    return DEFAULT_EXT;
}

function ensureDotPrefixed(extension)
{
    if (extension.startsWith("."))
    {
        return extension;
    }

    return extension ? `.${extension}` : "";
}

module.exports = {
    compile
}