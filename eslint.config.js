import react from 'eslint-plugin-react';
import globals from 'globals';
import babelParser from '@babel/eslint-parser';
import jest from 'eslint-plugin-jest';

//
// I'm open to changes to any of these settings.
// Let's talk about it first.
//
export default[
  {
    plugins: {
      react
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,

        // Assert class is global.
        Debug: 'readonly',

        // Our version or lodash.
        lgd: 'readonly',

        // Holds the admin database.
        admin: 'readonly',

        Oloo: 'readonly',
        UserRole: 'readonly',

        // We always have access to Phaser.
        Phaser: 'readonly',

        // One Game Instance per web page.
        gameInstance: 'writable',

        // Use Async.
        Promise: 'readonly',

        // Don't keep debugger in the code.
        debugger: 'off',

        paypal: 'readonly',
        document: 'readonly',
        window: 'readonly',
        global: 'readonly',
        globalThis: 'readonly'
      },

      parser: babelParser,
      ecmaVersion: 6,
      sourceType: 'module',

      parserOptions: {
        ecmaFeatures: {
          globalReturn: false,
          impliedStrict: true,
          jsx: true,
          restParams: true,
          templateStrings: true,
          generators: true,
          defaultParams: true
        }
      }
    },

    settings: {
      react: {
        pragma: 'React',
        version: 'detect'
      },

      linkComponents: [{
        name: 'Link',
        linkAttribute: 'route'
      }]
    },

    rules: {
      //
      // Possible Errors in https://eslint.org/docs/rules/
      //

      // Might not be needed.
      'no-empty-character-class': 'error',
      'no-misleading-character-class': 'warn',

      // Keep track to know if it works as intended.
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': [ 'warn', { skipComments: true } ],

      // Self evident:
      'getter-return': 'error',
      'no-extra-semi': 'error',
      'no-func-assign': 'error',
      'use-isnan': 'error',

      // Allow fn || fn()
      'no-unused-expressions': [ 'error', { allowShortCircuit: true } ],

      // Function should not be empty.
      'no-empty': 'error',

      // Confusing and could be unintentional.
      'no-cond-assign': 'error',

      // There shouldn't be a magic constant condition. Use a variable.
      'no-constant-condition': 'error',

      // We should log a lot.
      'no-console': 'off',

      // Invisible Characters are spooky.
      'no-control-regex': 'warn',

      // Unique names please.
      'no-dupe-args': 'error',

      // Class/Object keys should be unique.
      'no-dupe-keys': 'error',

      // This could be unintended to save you.
      'no-duplicate-case': 'error',

      // You should log the error and thats it.
      'no-ex-assign': 'error',

      // Sometimes this is useful.
      'no-extra-boolean-cast': 'error',

      'no-extra-parens': [ 'warn', 'all', {
        ignoreJSX: 'multi-line', returnAssign: false,
        nestedBinaryExpressions: true, enforceForArrowConditionals: true
      } ],

      // Functions and variables with var keyword should not be
      // created inside a inner scope.
      'no-inner-declarations': 'error',

      // Isn't possible.
      'no-obj-calls': 'error',

      // Shouldn't have to do this is if you create the Object correctly.
      'no-prototype-builtins': 'error',

      // Use {3} to signify how many spaces.
      'no-regex-spaces': 'warn',

      // Use new Array() or something this just looks weird and is hard to tell quickly.
      'no-sparse-arrays': 'warn',

      // This is probably not intended.
      'no-template-curly-in-string': 'error',

      // Try to keep things readable.
      'no-unexpected-multiline': 'error',

      // This is probably not intended. and prevents unused code.
      'no-unreachable': 'error',

      // Finally does weird things since it HAS to run
      'no-unsafe-finally': 'error',

      // in and instanceOf checks.
      'no-unsafe-negation': 'error',

      // Next level JavaScript error.
      'require-atomic-updates': 'error',

      // This is a god send. I love it.
      'valid-typeof': [ 'error', { requireStringLiterals: true } ],

      //
      // Best Practices in https://eslint.org/docs/rules/
      //

      // There are cases for == if you understand implicit coercion.
      eqeqeq: 'warn',

      // Should never have more than 2 files in a class,
      // just looks bad.
      'max-classes-per-file': [ 'error', 2 ],

      // Use custom modal for alert, prompt, and confirm
      'no-alert': 'error',

      // You need curly brackets for case statements.
      'no-case-declarations': 'warn',

      // Its cleaner.
      'no-else-return': 'error',

      // Always have curly brace for if statements.
      curly: [ 'error', 'all' ],

      // Causes accidental code running.
      'no-fallthrough': 'warn',

      // You should understand these.
      'no-implicit-coercion': [ 'warn', { allow: [ '!!', '~', '+' ] } ],

      // Why are you doing this.
      'no-implied-eval': 'error',

      // this should really only be called from inside object literals and classes.
      // It's too unpredictable.
      'no-invalid-this': 'error',

      // Are you really making this error.
      // Google closure now.
      'no-loop-func': 'error',

      // There might be some others but really const variables are better.
      'no-magic-numbers': [ 'warn', { ignore: [ 2, 1, -1, 0, 10, 100 ] } ],

      // Variables should only initialized once in the same scope.
      'no-redeclare': 'error',

      // Looks ugly make a new variable.
      'no-return-assign': 'error',

      // You better have a good reason.
      'no-extend-native': 'error',

      // Wrap in parentheses
      'no-sequences': 'warn',

      // Create an Error.
      'no-throw-literal': 'error',

      // These aren't that bad but it'd be better to have an issue logged on GitHub.
      'no-warning-comments': 'warn',

      // Not sure about this one yet.
      yoda: 'warn',

      // Not our style
      'no-eval': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-octal': 'error',
      'no-proto': 'error',
      'no-with': 'error',

      // Cleaner
      'no-multi-spaces': 'error',
      'no-new-wrappers': 'warn',

      // "no-return-await": "warn",
      'no-self-compare': 'error',
      'no-unused-labels': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-named-capture-group': 'warn',
      'require-await': 'error',
      'wrap-iife': 'error',

      //
      'no-self-assign': 'error',
      'no-unmodified-loop-condition': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'error',

      //
      // Variables in https://eslint.org/docs/rules/
      //

      // Not good code. Delete should only work on properties.
      'no-delete-var': 'error',

      // Labels should be unique.
      'no-label-var': 'error',

      'no-restricted-globals': [
        'error',
        {
          name: 'event',
          message: 'Use local parameter instead.'
        }
      ],

      // Could be unintended.
      'no-shadow': 'warn',

      // Gross
      'no-shadow-restricted-names': 'error',

      // No global variables without really good reason.
      // Include them down below if you decide there is a REALLY good reason.
      'no-undef': [ 'error', { typeof: true } ],

      // Use your variables stop taking memory punk.
      // If the variable is being used than this was setup incorrectly.
      'no-unused-vars': [ 'error', { vars: 'all', args: 'after-used', caughtErrors: 'all' } ],

      // We should be able to read from top to bottom. Don't use hoisting.
      'no-use-before-define': 'error',

      //
      // Node.js and CommonJS in https://eslint.org/docs/rules/
      //

      // You usually only want to call the call back once or have a return with the callback.
      'callback-return': [ 'error', [ 'next', 'response' ] ],

      // Handle all paramaters that have Err or err in the name.
      'handle-callback-err': [ 'error', '^.*(e|E)rr' ],

      // use Buffer.from or Buffer.alloc.
      'no-buffer-constructor': 'error',

      // We don't even want to be using new as much as possible.
      'no-new-require': 'error',

      // Use Path.join or Path.resolve.
      'no-path-concat': 'error',

      // Throw an error.
      'no-process-exit': 'error',

      // Use async versions to not bog down server.
      // You can use sync on client side if you need to.
      // This might be worth removing.
      'no-sync': 'warn',

      //
      // Stylistic Issues in https://eslint.org/docs/rules/
      //

      // Cleaner
      'no-trailing-spaces': 'warn',
      'no-nested-ternary': 'error',
      'no-whitespace-before-property': 'error',
      'wrap-regex': 'error',

      'max-len': [ 'error', {
        code: 120,
        comments: 180,
        tabWidth: 2,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignorePattern: '<.*>'
      } ],

      // I like using negated conditions.
      // "no-negated-condition": "error",

      // Line-break after blocks.
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'any', prev: 'block-like', next: 'break' },
        { blankLine: 'always', prev: 'class', next: '*' },

        // proptypes - defaultprops.
        { blankLine: 'always', prev: 'multiline-expression', next: 'multiline-expression' },
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'any', prev: 'export', next: 'export' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: 'cjs-export' },
        { blankLine: 'any', prev: 'cjs-export', next: 'cjs-export' },
        { blankLine: 'always', prev: 'cjs-import', next: '*' },
        { blankLine: 'any', prev: 'cjs-import', next: 'cjs-import' }
      ],

      // Be consistent and do new lines when needed.
      'array-bracket-newline': [ 'error', 'consistent' ],
      'array-element-newline': [ 'error', 'consistent' ],

      // This is more readable, singleValue is more readable without spaces.
      'array-bracket-spacing': [ 'error', 'always', { singleValue: false } ],

      // I came from c# so i like this style.
      'brace-style': [ 'error', 'stroustrup' ],

      // No trailing commas because it makes an undefined.
      // That was my reasoning i'm open to objections.
      'comma-dangle': [ 'error', 'never' ],

      // Looks nicer.
      'comma-spacing': [ 'error', { before: false, after: true } ],

      // Consitency.
      'comma-style': [ 'error', 'last' ],

      // No spacing looks best. obj["property"] vs obj[ "property" ]
      'computed-property-spacing': 'error',

      // Self is used in other languages so i choose self.
      // Really should be using closure though.
      'consistent-this': [ 'error', 'self' ],

      // Always call func from same line.
      // Why does this need to exist.
      'func-call-spacing': 'error',

      // It should always be explicit
      // try not to do implied behaviors like function naming.
      'func-names': 2,

      // less verbose. Also might want to allow arrow function at some point.
      'func-style': [ 'error', 'declaration' ],

      // put function params on new lines if more than 3.
      'function-paren-newline': [ 'error', 'multiline' ],

      // Don't use these words be more descriptive.
      // Add as we start figuring out more words.
      'id-blacklist': [ 'error', 'data', 'foo' ],

      // 30 is more than enough, think harder.
      // Add exceptions as we go.
      'id-length': [ 'error', { max: 45, min: 3, exceptions: [ 'x', 'y', 'z', 'w', 'uv', 'i', 'fs', 'to', 'OK', 'k', '_' ] } ],

      // come back to this.
      // "id-match": ["error", "^(_|[a-z])+([A-Z][a-z]+)*$", { "properties": true, "ignoreDestructuring": true }],

      // put it on the same line if there are no brackets. () => meme;
      'implicit-arrow-linebreak': 'error',

      // Legacy so it stays.
      indent: [ 'error', 2, {
        SwitchCase: 1
      } ],

      'key-spacing': [ 'error', { beforeColon: false, afterColon: true, mode: 'strict' } ],

      // Lets keep the spacing similar this will make reading files easier.
      'keyword-spacing': [ 'error',
        {
          after: false,
          overrides: {
            import: { after: true },
            export: { after: true },
            else: { after: true },
            case: { after: true },
            return: { after: true },
            from: { after: true },
            const: { after: true },
            let: { after: true },
            var: { after: true },
            try: { after: true }
          }
        } ],

      // Consistent line endings. avoid git problems.
      'linebreak-style': [ 'error', 'windows' ],

      // It looks nicer and is easier to read.
      'lines-around-comment': [ 'error',
        {
          beforeBlockComment: true,
          beforeLineComment: true,
          allowBlockStart: true,
          allowClassStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
          ignorePattern: '//'
        } ],

      // Files that are too big can be very complex.
      'max-lines': [ 'error', { max: 700, skipBlankLines: true, skipComments: true } ],

      // Typically this will be too big a function.
      // "max-lines-per-function": ["warn", { "max": 60, "skipBlankLines": true, "skipComments": true }],

      // Max depth of 4 default.
      'max-depth': 'error',

      // Jsconfig has the always strict set so no need to have it in file.
      strict: [ 'error', 'never' ],

      // It really hard to read if more than 3.
      'max-nested-callbacks': [ 'error', { max: 3 } ],

      // More than 4 is too much.
      // Function is probably doing too much.
      'max-params': [ 'warn', { max: 4 } ],

      // Each variable should be initialized on its own line.
      'max-statements-per-line': [ 'error', { max: 1 } ],

      // multiline-comment-style revisit we might want starred.

      // Be consistent.
      'multiline-ternary': [ 'error', 'always-multiline' ],

      // Have parens for classes creation.
      'new-parens': 'error',

      // Comments should be on their own line.
      'line-comment-position': 'error',

      // I love this rule.
      'lines-between-class-members': 'error',

      // Makes code more readable.
      'newline-per-chained-call': [ 'error', { ignoreChainWithDepth: 2 } ],

      // Only use Array constructor to create empty array of certain length.
      'no-array-constructor': 'error',

      // Comments should be on their own line.
      'no-inline-comments': 'off',

      // Use else-if.
      'no-lonely-if': 'error',

      // Only tabs.
      'no-mixed-spaces-and-tabs': 'error',

      // This looks nasty and can be unpredictable.
      'no-multi-assign': 'error',

      // Too many lines causes a lot of scrolling.
      'no-multiple-empty-lines': [ 'error', { max: 2 } ],

      // Use the Object literal {}.
      'no-new-object': 'error',

      // Specific things we don't allow.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='setTimeout'][arguments.length!=2]",
          message: 'setTimeout must always be invoked with two arguments.'
        }
      ],

      // Only use to indicate a private variable or function.
      // Turned off because it would go off in create().
      // "no-underscore-dangle": [
      //   "error",
      //   {
      //     "allowAfterThis": true,
      //     "allowAfterSuper": false,
      //     "enforceInMethodNames": false
      //   }
      // ],

      // Use a = x || 2; instead of a = x ? x : 2;
      'no-unneeded-ternary': [ 'error', { defaultAssignment: false } ],

      // These number might need to be tuned.
      // We need to be consistent.
      'object-curly-newline': [
        'error',
        {
          ObjectExpression: { consistent: true },
          ObjectPattern: { consistent: true },
          ImportDeclaration: { multiline: true, minProperties: 5 },
          ExportDeclaration: { multiline: true, minProperties: 3 }
        }
      ],
      'object-curly-spacing': [ 'error', 'always' ],

      // I don't like multiple initialization in one line.
      'one-var-declaration-per-line': [ 'error', 'always' ],
      'one-var': [
        'error',
        {
          var: 'never',
          let: 'never',
          const: 'never',
          separateRequires: true
        }
      ],

      // Cleaner and faster.
      'operator-assignment': 'error',

      // Really only put this for tertiary statements.
      // Check how it goes.
      'operator-linebreak': [ 'error', 'before' ],

      // Put them before or after the blocks not inside.
      'padded-blocks': [ 'error', 'never' ],

      // Just be consistent when you need to use quotes.
      'quote-props': [ 'error', 'as-needed' ],

      // Best way to name variables.
      camelcase: 'error',
      'new-cap': [ 'error', { newIsCap: true, capIsNew: true, properties: false } ],

      // Use a semicolon you heathan
      semi: [ 'error', 'always' ],
      'semi-spacing': 'error',
      'semi-style': 'error',

      // write if() { } instead of if(){ }
      'space-before-blocks': 'error',

      // Looks better.
      'space-before-function-paren': [ 'error', { anonymous: 'never', named: 'never', asyncArrow: 'always' } ],

      // Spacing around ++, +, -, --, |, ||, etc.
      'space-infix-ops': 'error',
      'space-unary-ops': [
        'error',
        {
          words: true,
          nonwords: false
        }
      ],

      // Always put one space before comment. Like before "Always" in this line of text.
      'spaced-comment': [ 'error', 'always', { markers: ['//'] } ],

      // no U+FEFF in file.
      'unicode-bom': 'error',

      // Let's be consistent.
      quotes: [ 'error', 'single', { allowTemplateLiterals: true, avoidEscape: true } ],
      'jsx-quotes': [ 'error', 'prefer-single' ],
      'space-in-parens': 'error',
      'switch-colon-spacing': [ 'error', { after: true, before: false } ],

      //
      // ECMAScript 6
      //

      // Could help against mistakes.
      'arrow-body-style': [ 'error', 'as-needed' ],

      // Multiple parens,
      'arrow-parens': [ 'error', 'as-needed', { requireForBlockBody: false } ],

      // Consistent spacing.
      'arrow-spacing': [ 'error', { before: true, after: true } ],
      'generator-star-spacing': [ 'error', { before: false, after: true } ],

      // Call Super in constructor. React won't give you props or state if you don't.
      'constructor-super': 'error',

      // This is important don't re-assign classes.
      'no-class-assign': 'error',

      // Surround with arrows so it's not confusing.
      'no-confusing-arrow': [ 'error', { allowParens: true } ],

      // Early warn against const assign.
      'no-const-assign': 'error',

      // Duplicate function with overwrite previous member.
      'no-dupe-class-members': 'error',

      // import everything at once not on different lines.
      'no-duplicate-imports': 'error',

      // No new on Symbol keyword.
      'no-new-symbol': 'error',

      // Use Require for imports
      'no-restricted-imports': [ 'error', {
        patterns: [
          '../',
          '../../',
          '../../../',
          '../../../../',
          '../../../../../',
          '../../../../../../',
          '../../../../../../../'
        ]
      } ],

      // Prevents errors.
      'no-this-before-super': 'error',

      // Only use if needed.
      'no-useless-computed-key': 'error',

      // Don't do useless things.
      'no-useless-rename': 'error',

      // Use Let or Const.
      'no-var': 'error',

      // Use one or the other at a time.
      'object-shorthand': [ 'error', 'methods' ],

      // Use Arrow callback unless you use this then create function and bind in constructor.
      'prefer-arrow-callback': [ 'error', { allowNamedFunctions: false, allowUnboundThis: false } ],

      // Use const whenever you can.
      'prefer-const': 'error',

      // No need to parse in ES6.
      'prefer-numeric-literals': 'error',

      // Template look a lot better. use ``
      'prefer-template': 'error',

      // Generators should use yield.
      'require-yield': 'error',

      // Keep them together like ++ and --.
      'rest-spread-spacing': [ 'error', 'never' ],

      // Easier debugging.
      'symbol-description': 'error',

      // It looks better imo.
      'template-curly-spacing': [ 'error', 'never' ],

      // Consistent spacing.
      'yield-star-spacing': [ 'error', { before: false, after: true } ],

      //
      //
      // React Rules https://github.com/yannickcr/eslint-plugin-react
      //
      //

      // Booleans should follow proper naming.
      // "react/boolean-prop-naming": ["error", {
      //   "propTypeNames": ["bool", "mutuallyExclusiveTrueProps"],
      //   "rule": "^(is|has|show)[A-Z]([A-Za-z0-9]?)+",
      //   "message":  "Change boolean PropName {{ propName }} to is|has|show(PropName)"
      // }],

      // default props should not be provided for required propTypes.
      'react/default-props-match-prop-types': 'error',

      // Use arrow function to get last state.
      'react/no-access-state-in-setstate': 'error',

      // Don't pass children as a prop. Set it properly.
      'react/no-children-prop': 'error',

      // We are removing prop-types in production.
      // "react/forbid-foreign-prop-types": "error",

      // The key is used by React to identify which items have changed, are added, or are removed and should be stable.
      'react/no-array-index-key': 'error',

      // Should be sanitized first.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',

      // Read the new info on React Components to find out what to do.
      'react/no-deprecated': 'error',

      // NEVER mutate this.state directly, as calling setState() afterwards may replace the mutation you made.
      // Treat this.state as if it were immutable.
      'react/no-direct-mutation-state': 'error',

      // I might consider ignoreStateless.
      // Each class should have its own file for readability.
      // "react/no-multi-comp": "error",

      // Don't use pure component and check for update.
      'react/no-redundant-should-component-update': 'error',

      // Helps.
      'react/no-typos': 'warn',

      // Use {"I'm"} instead of I'm it will prevent errors inside of tags.
      'react/no-unescaped-entities': 'error',

      // Use React.createRef()
      'react/no-string-refs': [ 'error', { noTemplateLiterals: true } ],

      // Attempting to access properties on this can be a potential error if someone is unaware of the differences
      // when writing a SFC or missed when converting a class component to a SFC.
      'react/no-this-in-sfc': 'error',

      // class vs className help remember react style.
      'react/no-unknown-property': 'error',

      // These are getting deprecated. Let's replace with the correct way.
      'react/no-unsafe': ['warn'],

      // Although we transpile it out it makes sense for autocomplete to only have useful proptypes.
      'react/no-unused-prop-types': 'error',

      // Let's use the memory we need to.
      'react/no-unused-state': 'error',

      // proptypes will be used to autocomplete and see options for rendering class.
      'react/prop-types': 'error',

      // When using JSX, <a /> expands to React.createElement("a"). Therefore the React variable must be in scope.
      // Webpack now includes React so no need to include.
      // "react/react-in-jsx-scope": "error",

      // Default Props are nice.
      'react/require-default-props': [ 'error', { forbidDefaultForRequired: true } ],

      // Obvious mistake why not.
      'react/require-render-return': 'error',

      // It looks better.
      'react/self-closing-comp': 'error',

      // Having it in a certain order makes it easier to find methods later.
      'react/sort-comp': [ 'error', {
        order: [
          'constructor',
          'static-variables',
          'static-methods',
          'getters|setters',
          'lifecycle',
          '/(^(_|)get.+$)|(^(_|)set.+$)/',
          '/^(_|)on.+$/',
          'submit',
          'everything-else',
          '/^(_|)render.+$/',
          'render'
        ],
        groups: {
          submit: [
            'submit',
            '/^(_|)submit.+$/'
          ]
        }
      } ],

      // This is just convention to be consistent.
      'react/state-in-constructor': [ 'error', 'always' ],

      // proptypes and default props at bottom of file.
      'react/static-property-placement': [ 'error', 'static public field', {
        defaultProps: 'property assignment',
        propTypes: 'property assignment'
      } ],

      // Consistency
      'react/style-prop-object': 'error',

      // Should really not have children. (e.g. img, br, hr)
      'react/void-dom-elements-no-children': 'error',

      //
      //
      // JSX Rules https://github.com/yannickcr/eslint-plugin-react
      //
      //

      // It looks nicer.
      'react/jsx-boolean-value': [ 'error', 'always' ],

      // Consistency
      'react/jsx-closing-bracket-location': [ 'error', 'after-props' ],

      // "react/jsx-closing-tag-location": "error",
      'react/jsx-curly-newline': [ 'error', { multiline: 'consistent', singleline: 'consistent' } ],
      'react/jsx-equals-spacing': [ 'error', 'never' ],
      'react/jsx-max-props-per-line': [ 'error', { maximum: 1, when: 'multiline' } ],

      'react/jsx-tag-spacing': [ 'error', {
        closingSlash: 'never',
        beforeSelfClosing: 'always',
        afterOpening: 'never',
        beforeClosing: 'allow'
      } ],

      // We always use .js
      'react/jsx-filename-extension': [ 1, { extensions: ['.js'] } ],

      // Prevents no-unused for JSX.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      // Might comeback to this,
      // "react/jsx-first-prop-new-line": "error",

      // Warn for potential jsx key
      'react/jsx-key': 'warn',

      // Time to make a new function.
      'react/jsx-max-depth': [ 'error', { max: 5 } ],

      // Keep indent style for jsx as well.
      'react/jsx-indent': [ 'error', 2, { indentLogicalExpressions: true } ],
      'react/jsx-indent-props': [ 'error', 2 ],

      // Might be usefull to also specify  "eventHandlerPrefix": <eventHandlerPrefix>,
      // "react/jsx-handler-names": ["error", {
      //   "eventHandlerPrefix": "on",
      //   "eventHandlerPropPrefix": "on"
      // }],

      // Place bind in constructor.
      'react/jsx-no-bind': 'error',

      // Should put it in brackets { /* hello */ }
      'react/jsx-no-comment-textnodes': 'error',

      // Mistake also should not be possible to have same variable with different casing.
      'react/jsx-no-duplicate-props': 'error',

      // Security
      'react/jsx-no-target-blank': 'warn',

      // Most likely a mistake we should import components from somewhere.
      'react/jsx-no-undef': 'error',

      'react/jsx-curly-brace-presence': [ 'error', { props: 'never', children: 'ignore' } ],

      // Pascal case for components.
      'react/jsx-pascal-case': 'error',

      // No multi spaces..
      'react/jsx-props-no-multi-spaces': 'error',

      // Be Explicit.
      'react/jsx-props-no-spreading': 'error',

      'react/jsx-wrap-multilines': [ 'error', {
        declaration: 'parens-new-line',
        assignment: 'parens-new-line',
        return: 'parens-new-line',
        arrow: 'parens-new-line',
        condition: 'parens-new-line',
        logical: 'parens-new-line',
        prop: 'parens-new-line'
      } ]

      // Ones we should think about.
      // "react/prefer-es6-class": "0",
      // "react/jsx-sort-default-props": "error"
      // "react/sort-prop-types": "error"
      // "react/jsx-no-literals": "error" Could be usefull for translations.
      // "react/jsx-fragments": "error" Might be more efficient.
      // "react/jsx-one-expression-per-line": [ "error", { "allow": "single-child" } ],
      // "react/jsx-curly-spacing": [2, {
      //   "when": "always",
      //   "allowMultiline": true,
      //   "spacing": { "objectLiterals": "never" }
      //   }
      // ],
    }
  },
  {
    files: [ '**/*.test.js', '**/jest.setup.js', '**/jest.setup.native.js' ],

    plugins: {
      jest
    },

    languageOptions: {
      globals: {
        ...jest.environments.globals.globals
      }
    }
  },
  {
    files: [ 'server/**.js', '**/server.js' ],

    rules: {
      'no-restricted-imports': [ 'error', {
        patterns: [
          'APPROOT',
          'SRC',
          'CAREERSRC',
          'PAGES',
          '../',
          '../../',
          '../../../',
          '../../../../',
          '../../../../../',
          '../../../../../../',
          '../../../../../../../'
        ]
      } ]
    }
  }
];