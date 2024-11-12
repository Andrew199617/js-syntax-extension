const path = require('path');
const vscode = require('vscode');
const fs = require('fs');

/**
* @description
* @type {FileIOType}
* @static
*/
const FileIO = {
  writeFileContents(filepath, content) {
    return new Promise((resolve, reject) => {
      const write = err => {
        if(err) {
          return reject(err);
        }

        fs.writeFile(filepath, content, err => {
          if(err) {
            reject(err);
          }
          else {
            resolve();
          }
        });
      };

      const dir = path.dirname(filepath);
      fs.existsSync(dir) ? write(null) : FileIO.mkdirRecursive(dir, write);
    });
  },

  async mkdirRecursive(fullDir, callback) {
    let dirs = fullDir.replace(`${vscode.workspace.rootPath}\\`, '');
    dirs = dirs.split(/\\/)
      .map((dir, index, array) => {
        let subDir = '';
        for(let i = 0; i < index; ++i) {
          subDir += `${array[i]}\\`;
        }

        return `${vscode.workspace.rootPath}\\${subDir}${dir}`;
      });

    for(let currentDir = 0; currentDir < dirs.length; currentDir++) {
      if(!fs.existsSync(dirs[currentDir])) {
        await fs.mkdir(dirs[currentDir], { recursive: true }, err => {
          throw err;
        });
      }
    }

    callback();
  },

  /**
  * @description Make sure the new path dir exists and then rename.
  * Cleans up old dir if it has no files.
  */
  async rename(oldPath, newPath, callback) {
    const dir = path.dirname(newPath);
    const oldDir = path.dirname(oldPath);

    const renamed = () => {
      fs.readdir(oldDir, (err, files) => {
        if(err) {
          // some sort of error
          console.error(err);
        }
        else if(!files.length) {
          fs.rmdir(oldDir, () => {
            console.log(`LGD: Removed Old Dir ${oldDir}`);
          });
        }
      });

      callback();
    };

    fs.exists(dir, exists => {
      if(!exists) {
        FileIO.mkdirRecursive(dir, () => {
          fs.rename(oldPath, newPath, renamed);
        });
      }
      else {
        fs.rename(oldPath, newPath, renamed);
      }
    });
  }
};

module.exports = FileIO;