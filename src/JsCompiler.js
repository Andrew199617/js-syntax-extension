const  path = require('path');
const  fs = require('fs');
const  vscode = require('vscode');

const FileParser = require("./FileParser");

const DEFAULT_EXT = ".d.ts";
const DEFAULT_DIR = "typings"

// compile the given less file
async function compile(jsFile, content)
{
    const typeFile = FileParser.parse(content);
    
    const parsedPath = path.parse(jsFile);
    
    let dirInRoot = "";
    if(lgd.configuration.options.maintainHierarchy) {
        dirInRoot = parsedPath.dir.replace(vscode.workspace.rootPath, "");
    }

    const baseFilename = parsedPath.name;
    const typeFilePath = `${vscode.workspace.rootPath}\\${DEFAULT_DIR}${dirInRoot}\\${baseFilename}${DEFAULT_EXT}`;

    await writeFileContents(typeFilePath, typeFile);

    return;
}

async function mkdirRecursive(fullDir, callback) {
    let dirs = fullDir.replace(`${vscode.workspace.rootPath}\\`, "");
    dirs = dirs.split(/\\/)
        .map((dir, index, array) => {
            let subDir = '';
            for(let i = 0; i < index; ++i) {
                subDir += `${array[i]}\\`;
            }

            return `${vscode.workspace.rootPath}\\${subDir}${dir}`;
        })
        
    for(let currentDir = 0; currentDir < dirs.length; currentDir++) {
        if(!fs.existsSync(dirs[currentDir])) {
            await fs.mkdir(dirs[currentDir], { recursive: true }, err => { throw err });
        }
    }

    callback();
}

// writes a file's contents in a path where directories may or may not yet exist
function writeFileContents(filepath, content)
{
    return new Promise((resolve, reject) =>
    {
        const write = err => {
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
        };

        const dir = path.dirname(filepath);
        fs.existsSync(dir) ? write(null) : mkdirRecursive(dir, write);
    });
}

module.exports = {
    compile
}