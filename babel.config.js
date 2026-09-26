/* eslint-disable line-comment-position */

// Babel presets are intentionally empty; tests only need module aliases.
const presets = [];

// Resolve the project aliases used by the test suite.
const plugins = [
    [
        'module-resolver',
        {
            root: ['./'],
            alias: {
                TESTS: './tests',
                SRC: './src'
            },
            cwd: 'babelrc'
        }
    ]

    // `${__dirname}/shared/Babel/NameOf.cjs`
];

// Files to ignore.
const ignore = [];

module.exports = {
    presets: presets,
    plugins: plugins,
    env: {
        production: {
            plugins: [
                // `${__dirname}/shared/Babel/RemoveAssert.cjs`
            ]
        }
    },
    ignore
};
