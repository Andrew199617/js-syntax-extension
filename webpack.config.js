const path = require('path');

/** @type {import('webpack').Configuration}*/
const config = {
  target: 'node',
  optimization: {
    minimize: true
  },
  entry: './src/LGD.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    mainFields: [ 'browser', 'module', 'main' ],
    extensions: [ '.ts', '.js' ],
    alias: {
      SRC: path.resolve(__dirname, 'src')
    },
    fallback: {
      path: require.resolve('path-browserify')
    }
  }
};

module.exports = config;
