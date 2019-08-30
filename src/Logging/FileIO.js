const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

/**
* @description
* @type {FileIOType}
* @static
*/
const FileIO = {
  writeFileContents(filepath, content) {
    return new Promise((resolve, reject) => {
      const write = err => {
        if (err) {
          return reject(err);
        }

        fs.writeFile(filepath, content, err => {
          if (err) {
            reject(err)
          }
          else {
            resolve()
          }
        });
      };

      const dir = path.dirname(filepath);
      fs.existsSync(dir) ? write(null) : this.mkdirRecursive(dir, write);
    });
  },

  async mkdirRecursive(fullDir, callback) {
    let dirs = fullDir.replace(`${vscode.workspace.rootPath}\\`, "");
    dirs = dirs.split(/\\/)
      .map((dir, index, array) => {
        let subDir = '';
        for (let i = 0; i < index; ++i) {
          subDir += `${array[i]}\\`;
        }

        return `${vscode.workspace.rootPath}\\${subDir}${dir}`;
      })

    for (let currentDir = 0; currentDir < dirs.length; currentDir++) {
      if (!fs.existsSync(dirs[currentDir])) {
        await fs.mkdir(dirs[currentDir], { recursive: true }, err => { throw err });
      }
    }

    callback();
  },
};

module.exports = FileIO;