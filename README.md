# JS to TS typings Compiler and JS Syntax Highlighter.

[![Marketplace Version](https://vsmarketplacebadges.dev/version-short/learn-game-development.js-syntax-extension.png)](https://marketplace.visualstudio.com/items?itemName=learn-game-development.js-syntax-extension)
[![Installs](https://vsmarketplacebadges.dev/installs/learn-game-development.js-syntax-extension.png)](https://marketplace.visualstudio.com/items?itemName=learn-game-development.js-syntax-extension)
[![Downloads](https://vsmarketplacebadges.dev/downloads/learn-game-development.js-syntax-extension.png)](https://marketplace.visualstudio.com/items?itemName=learn-game-development.js-syntax-extension)


[![Tests](https://github.com/Andrew199617/js-syntax-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/Andrew199617/js-syntax-extension/actions/workflows/tests.yml)

### Use Cases:

- Use typescript checking without needing to convert js files. We don't currently allow you to switch to TS using the extension. This extension is for better autocomplete, type checking, and more using JSDocs.
- Need improved intellisense for JavaScript? You will be able to leverage the typings folder and be able to more easily access types from other classes. This is a huge productivity boost!
- Create Types folder for a NPM module in seconds.
- Maintain OLOO pattern. Using Oloo is optional, you can use functions, classes, or Objects linked to other objects.
- This extension is for someone who prefers using vanilla Javascript with jsdoc over TypeScript.

### Have Issues?
- If it looks like a file is being generated incorrectly check the log file and file an issue on Github. This has high priority for me since i use it for my website.

### Compilation
- There is many ways to create a class in JavaScript, there is no such thing as a 'class' only objects.
- We like to use Object literals and take advantage of the builtin Object.create and Object.assign functions to create classes from the Object literals.
- You can also use class for support with React.
- Provides Quick Fix and Code Actions for fixing JS for TS export.

# Quick Fixes
- Invert If statement to reduce Christmas tree code.
- Extract Function into class or object scope.
- Move createReactClass to export at end of file.

### Syntax
- Provide syntax highlighting for scenarios we encounter a lot in our codebase.
- This allows us to easily know what is going on in a file and avoid errors with naming.
- Things like proptypes and defaultProps gets used very often so its a good idea to have syntax highlighting for these keywords.

### Other Extensions:
- JS/React Snippet Extension

# Features

## LGD diagnostic quick fixes

In a `.lgd` file, place the cursor on a diagnostic and open Quick Fix with `Ctrl+.` (`Cmd+.` on macOS):

- **Add override keyword** declares an override of a known inherited virtual method. If the child already uses `virtual`, **Replace virtual with override** repairs the modifier without changing its method body.
- **Make Base.method virtual** updates the known LGD class declaration for a child explicitly marked `override`, including a base imported from another `.lgd` file.
- **Remove extra arguments from base call** removes an extra primitive-literal suffix when the base constructor's parameter count is known.
- **Change parameter to String** suggests an explicit annotation-only change for a proven module-private or nested-local Number parameter assigned String values. The action discloses its signature change and any existing diagnostics that remain.
- **Change parameter and return type to String** updates both exact annotations in one edit when the complete method is proven to return only String and its contract is private and unreferenced.
- **Change return type to String** is a separate followup suggestion when the remaining return mismatch has the same safety proof.

Argument removal is an explicit choice. Calls, property reads, spreads, and comments in the removed suffix are preserved by leaving the diagnostic for you to resolve. Missing arguments are never filled with guessed values. Fixes check that the source and imported contracts are still current, support Undo, and refresh Problems after application.

Parameter changes are suggestions, never Fix All or a preferred automatic action. They are withheld for script-global or exposed owners, known callers, exports, inherited/interface contracts, defaults, rest/destructured parameters, captures, mixed writes, unknown return values or a preview that adds errors. Merely having no references in the open file does not prove a global contract is unused. The assignment and return contract remain unchanged; changing only a parameter does not guarantee every error is fixed. A return contract changes only through the explicitly chosen safe combined or followup action.

A missing assignment expression such as `const broken = ;` is reported as **Expected an expression after '='. Add a value.** at the semicolon. Add the intended value or expression before saving; the extension does not guess one.

LGD diagnostics show short categories such as **syntax**, **type** and **inheritance**. Internal compiler IDs are retained separately for correct Quick Fix association.

LGD keyword highlighting distinguishes control flow such as `return` and `if` from declarations/modifiers such as `class`, `static` and `virtual`, and from the `void` return-type keyword. Your theme chooses their colors. Contextual highlighting does not add compiler support for otherwise unsupported keywords.

## LGD classes with OLOO instances

In `.lgd` files, use `class`, a colon for inheritance, and the class name for its constructor:

```lgd
const { Oloo } = require('@mavega/oloo');
readonly Object BaseCommand = require('./BaseCommand');

class GoToAssignment : BaseCommand {
    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") {
        this.enabled = true;
    }

    override async executeCommand() {
        // Command implementation
    }
}

const command = GoToAssignment.create();
```

These declarations compile to OLOO objects, preserving the `.create()` API. Constructor assignments initialize each instance; ordinary methods, async methods, getters and setters stay on the linked objects. Derived classes use the existing `Oloo` binding to call `Oloo.assign(BaseCommand.create(...), GoToAssignment)`. Existing OLOO base objects continue to work, including `Oloo.base(this, "methodName")` dispatch.

Use typed parameters such as `String title` and `Number offset = 0` in constructors and methods. A missing constructor or base initializer calls the base's `.create()` with no arguments. Known base signatures are checked for argument counts and types; unresolved values remain conservative. Class names, base names and same-name constructors use your theme's class/type highlighting; ordinary methods keep method highlighting.

Declare overridable class methods with `virtual`, and use `override` when replacing an inherited virtual method. Replacing a known non-virtual method or omitting `override` is an error. Existing OLOO base methods can opt in with a JSDoc `@virtual` tag. Known parameter and explicit return-type mismatches are reported across local and imported bases. Modifiers are compile-time checks and do not change OLOO method dispatch.

Call an inherited method with `base.method(arguments)` inside an LGD class method. The compiler uses the defining class's linked parent and preserves the current instance, arguments, return values, and `await`. This also works inside nested arrow callbacks. Constructor `: base(...)` continues to allocate through the base factory. Computed or optional base access, detached method references, getter access, and ordinary nested function callbacks are diagnosed instead of guessing their receiver.

The constructor must use the class name. The `constructor` keyword, an explicit `create()` member, fields, static members and private members are not supported in LGD class declarations. Put instance initialization in the constructor. JavaScript files keep their existing class behavior.

## LGD interfaces and abstract classes

Declare method contracts with typed parameters and a return type. Interfaces can inherit multiple interfaces; classes can name one base first, followed by interfaces:

```lgd
const { Oloo } = require('@mavega/oloo');

interface IRunner {
    Number run(Number count);
}

abstract class RunnerBase : IRunner {
    abstract Number run(Number count);
    String describe() { return "runner"; }
}

class Runner : RunnerBase {
    override Number run(Number count) { return count + 1; }
}

const runner = Runner.create();
```

A concrete class must supply compatible implementations, including inherited implementations. Abstract classes may defer missing members. Abstract methods require an abstract class and have no body; implementing an inherited abstract member requires `override`. Interface inheritance, parameter counts, rest/default parameters, explicit types, return types, and property accessors are checked across relative `.lgd` imports. Abstract classes and interfaces cannot be instantiated directly. Interfaces have no runtime value.

Property contracts use `String name { get; set; }`, with either or both accessors. In an abstract class, write `abstract String name { get; set; }`. Implement them with existing LGD accessors, such as `get String name() { return this._name; }` and `set name(String value) { this._name = value; }`; add `override` when implementing an inherited abstract property. Instance initialization remains in the class-name constructor.

JavaScript output erases interface declarations, interface-only require bindings, and abstract member declarations. Editor-only JSDoc typedefs retain interface shapes. Abstract classes retain their concrete constructor and methods. Errors appear in Problems and prevent a save from replacing the last working `.js` file. These are editor/compiler checks; externally supplied JavaScript values remain dynamic, and emitted code does not install runtime abstract/interface guards.

This initial contract syntax does not include overloaded methods, generic interfaces, static interface members, access modifiers, or field declarations. Use explicitly typed method/property contracts. Opaque external annotation identities remain conservative.

## LGD output choices

The target language and the JavaScript object model are separate settings:

```json
"lgd.options": {
    "outputTarget": "javascript",
    "javascriptObjectModel": "oloo"
}
```

`outputTarget` currently supports only `javascript`. C# and C++ output are not implemented. Unsupported target values produce a diagnostic and preserve the previous output.

`javascriptObjectModel` supports `oloo` (the default) and `class`. Both preserve the source's `Name.create(...)` caller API. Native class output emits real JavaScript classes and requires class bases; known OLOO object bases and `Oloo.base` calls are diagnosed. Use `base.method(...)` for class inheritance calls.

Choose native classes deliberately: methods live on `.prototype`, instances use native class construction, and a base constructor's virtual method calls dispatch to the derived implementation during construction. OLOO keeps its existing base-factory lifecycle and object-level method API. Changing the setting refreshes open LGD mirrors; save the source to update its adjacent JavaScript file.

## Generated JavaScript checks

Before updating a `.js` file, the compiler checks the completed output for syntax errors. This applies to OLOO and native class output, including ordinary JavaScript written alongside LGD declarations. Malformed JavaScript and unsupported type syntax left in the output are reported at the original LGD source location. The previous working `.js` stays unchanged until the source is repaired.

JavaScript modules, CommonJS and JSX remain supported. Top-level returns are accepted for Node/CommonJS wrapper execution; ES-module and class-static-block returns are rejected. JSX still uses your project's normal JSX build step.

## Typed assignments and lexical scopes

Declared locals and typed parameters are checked in top-level `Function` initializers, ordinary JavaScript function bodies, object methods, classes, constructors and nested callbacks. Writes use the actual lexical binding, so a shadowing callback parameter or block local does not inherit an unrelated outer type. Compound assignments and known destructuring values are checked too; rest parameter bindings are arrays.

Method return checks follow the current value through assignments and branches instead of treating its declared type as proof. Known `null` or `undefined` values cannot satisfy a non-void return contract. LGD still permits null and undefined in assignment positions; unknown calls and effects remain conservative.

## Explicit LGD method return types

Class and object methods can declare their return type before the method name:

```lgd
class Counter {
    Counter() { this.total = 0; }
    Number count() { return this.total; }
    void reset() { this.total = 0; }
    async Number loadCount() { return 2; }
}
```

`void` means `undefined`: falling through, `return;`, and `return undefined;` are allowed, while known returned values and `null` are rejected. Non-void methods must return a compatible value on every normal completion path; throwing is also allowed. Async methods declare their resolved value type, so `async Number` returns a `Promise<number>` and `async void` returns a `Promise<undefined>`.

Constructors keep their implicit instance result through `.create()`. Existing methods without return annotations remain supported. Annotations on accessors and generators are currently rejected; arrow and standalone function return syntax is not introduced by this feature. Checks remain conservative when an expression's type cannot be determined. Generated JavaScript removes the type syntax and documents the return contract without inserting return statements.

## Invert if into a guard clause

Place the cursor on an `if` condition and choose **Invert If Statement**, or run the LGD invert-if command. The action lifts the body out of the conditional and uses an early `return`, a loop `continue`, or an existing exit:

```js
// Before
function process(item) {
    if (item) {
        save(item);
    }
}

// After
function process(item) {
    if (!item) {
        return;
    }

    save(item);
}
```

Repeat on nested conditions to flatten a tree. JavaScript, JSX, TypeScript, and TSX are supported, including multiline conditions and `else` branches. The action preserves comments, literal contents, and indentation. It retains a block when removing it would change variable scope, and is only offered when an early exit preserves the surrounding control flow.

## JSDoc import highlighting

JSDoc imports such as `/** @import { Node as AstNode } from 'estree' */` now highlight imported names, aliases, `as`/`from`, and module strings using normal import theme scopes. Supports JavaScript and JSX, including multiline, default and namespace imports. Reload VS Code after installing the updated VSIX. Colors follow your theme; no settings changes are needed for this syntax rule.

## Callback parameter semantic highlighting

If a function-valued `@param` has the wrong color, add `parameter:javascript` to your existing `editor.semanticTokenColorCustomizations.rules`, using your preferred parameter color:

```jsonc
"parameter:javascript": "#9CDCFE"
```

## Compile .js file into .ts file automagically. Read below to use!

Search for commands under LGD ctrl+shift+P. You can call the command "Compile js file into ts file" or turn generateTypings setting to true.

The .ts file will be placed into the typings folder in your root directory. This is here vscode looks for typings.
- You need to have a jsconfig or tsconfig for vscode to pick up your typings automatically.
- The auto-compile is sensitive to tab size. It picks up your tab size from editor.tabSize. It is highly recommended that you use ESLINT with indent set to error.
- You have to use Stroustrup or Allman style brackets.
### Make sure you set your @type tag correctly.
- We will generate a interface like {classname}Type. Add @type {{classname}Type} to the object literal.

### Auto Compile
<img src="./images/autocompile.gif" width="50%" />

### Compile propTypes for Functional Components into an interface.
``` js
import React from 'react';
import Proptypes from 'prop-types';

/**
* @description
* @param {TestProps} props
*/
function Test(props) {
  return (
    <h1>
      Functional component. We'll generate an interface for your props.
    </h1>
  );
}

// This will be compiled into an interface called TestProps.
Test.propTypes = {
  /**
   * @description leave a description here.
   * @type {string}
   */
  test: Proptypes.string
};

export default Test;

///
/// File in typings/**/Test.d.ts
///

declare interface TestProps {
	static test: string;
};

```

### Maintain Hierarchy
<img src="./images/maintainhierarchy.gif" width="50%" />

### Highlight Foo.create() like new Foo().

![Foo.create Highlighting](./images/objectcreate.png)

### Code highlighting for comments with issues in them. A comment with an issue contains a #[0-9]

![TODO && Issues](./images/comments.png)

### React & Next

![React & Next Builtins](./images/reactnextbuiltins.png)

# Change Color

## Change the color using these in your settings

``` json
"editor.tokenColorCustomizations": {
    "textMateRules": [
        {
            "scope": "comment.todo",
            "settings": {
                "foreground": "#EE82EE"
            }
        },
        {
            "scope": "comment.issue",
            "settings": {
                "foreground": "#5555EE"
            }
        },
        {
            "scope": "variable.react",
            "settings": {
                "foreground": "#9370DB"
            }
        },
        {
            "scope": "variable.next",
            "settings": {
                "foreground": "#9370DB"
            }
        }
    ]
},
```

## All Scopes

- comment.issue
- comment.todo
- variable.next
- variable.react
- keyword.create

# Settings

``` json
{
  // Required for callback parameter semantic highlighting.
  "editor.semanticHighlighting.enabled": true,

  "lgd.options": {

    // This extension will provide autocomplete/snippets when
    // you start typing certain words.
    "autoComplete" : {
      // Should we autocomplete.
      "enabled" : true
    },

    // Generate typescript file whenever you save a JS f=File.
    "generateTypings": true,

    // Generate typescript file whenever you change a JS File.
    "generateTypingsOnChange": true,

    // Place typescript in folder that relates to JS file in typings folder.
    "maintainHierarchy": true,

    // Whether to write debug info to file in Typings folder.
    // Also determines if you are notified about debug log.
    "createDebugLog": true,

    // If we extract props and state you will be able to use it later if you want to use it as a Template
    // Can also be used for inheriting a class.
    // Extracted interface will be ClassNameProps & ClassNameState.
    "extractPropsAndState": true
  }
}
```

# Goals for 2024

- ~~Auto Compile whole project into typings folder.~~
- ~~Auto Compile React Class.~~
- ~~AutoComplete for React Proptypes.~~ https://www.learngamedevelopment.net/blog/reactpropsintellisense-autocomplete
- Classes with Type at the end need to show as error.
- ~~Save Enum as ts enum.~~
- ~~File rename updates typings file.~~
- ~~Parse return for methods.~~
- Allow the compilation of the whole project into actual TS files not just interfaces.
  - This will allow a user to migrate their entire JS project to TS if they desire.
- Make it so Static Variables only show as an option when you are calling them without using the 'this' keyword. Using class keyword in ts file gets us half the way there.
- checkJs should not cause any issues on our end.

# Known Issues

~~Everything is thrown in the typings folder.~~

~~We need to add option to keep directory structure in typings folder.~~

Function is not created correctly when initialized inside of create and constructor.

Array of Array does not generate type properly defaults to any[].

Manual Adding of Class type.

- Extension samples for adding to this extension. https://github.com/microsoft/vscode-extension-samples/tree/86df3b9422c7fb0987f2f7bc05235875b981b000

# Release Notes

## V2

See changelogs for more info.

## 2.4.0

- Parsing propTypes for React Components and React objects not using ES6.
- see changelog.

## 2.3.0

- Added First Quick Fix, more to come.
- see changelog.

### 2.2.6 - 2.2.7

- Added notification to check log. Disabled if createDebugLog is false.
- Added support for getter and setters in Object Literal.

### 2.2.3 - 2.2.5

- Added ability to compile every js file in your project.
- Improved Error Reporting and logging.
- Auto Compile React Class.
- Nested Objects. Very useful for Creating the state object in React.

### 2.2.0 - 2.2.1

- Added the ability to compile on change.
- Improved Error reporting. Specify exact line error and warnings occur on for you to easily fix.
- Logging Errors that occure that aren't breaking to a log file in typings folder.

### 2.1.1 - 2.1.5

- Added maintainHierarchy to settings.
- Improved parsing of create method.

### 2.1.0

- Compile to js to ts now working with inline array.
- Add static keyword.
- Problems being shown for you to fix.
- Create method being parsed for non static variables.

### 2.0.5 - 2.0.6

- Command works now even if you dont have generateTypings set.
- Fixed typed file. interface needs to have a different name than the object for vscode to pick up.

### 2.0.3 - 2.0.4

- Add async and prevent breaking on nested functions
- Add ability to parse defaultValue in function paramaters.

### 2.0.0 - 2.0.2

- Compile a js file into a .d.ts file.
  - This will allow you to have intellisense throughout the whole project.
  - Activate auto compile with settings.

## V1

### 1.1.3 - 1.1.5

- Add highlighting for react keywords. proptypes, and defaultProptypes.
- Add highlighting for next keyword. getInitialProps.

### 1.1.1 - 1.1.2

- Fixed bug where create whould highlight in object literal comments.

### 1.1.0

- Added assign highlighting like create
- Treating Capital Object Literals like a class.

### 1.0.3 - 1.0.6

- Added TODO syntax highlight.
  - scopename: comment.todo.js
- Added Issue comment highlight.
  - scopename: comment.issue.js

### 1.0.0-1.02

Initial release
- Added foo.create syntax highlighting.
