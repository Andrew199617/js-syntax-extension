# Change Log

All notable changes to the "js-syntax-extension" extension will be documented in this file.

# Version 2

# 2.6.0+

- Add way to get templates for a give classNameType. Convert classNameType to classNameType<T>.
  - You no longer need to provide templates when using the class you are in as a return value.
- Improved regex parsing of function parameters.
- Add test for function components.
- Fix configuration file to work by default.
- Add functionality to parse ['']
  - Will now parse -> this.state['valueName'] = 'value';
  - valueName will be added to state interface.
- Added functionality to have infinite . while setting object.
  - this.state.parent.parent2.valueName = 'value';
  - Does not setup up object right now that will be in another version. For now it no longer will cause an issue.


# 2.5.0+

- Added Tests to Project, this will make sure no regression happen when features are added in future.
- Improvements to Class Parser.
  - You can extend classes besides React.Component now.
  - Adding props and state to React.Component<> by default.
- export const obj = {}; is now being parsed.
- Parsing template correctly if using comma. No longer have to define all templates on new lines.

# 2.4.0+

- Adding extends React.Component by default if the object is a react component.
- Parsing propTypes for React Components and React objects not using ES6.
  - Parsing propTypes for Functional Components as well.
- Handling Renaming of Files. Renaming a js file will update the file path and name of the ts file.
- Fixed StatusBarMessage clear timeout. Change colors of status bar.
- Allow use of this inside of create function if you are creating a ReactComponent.
  - This is determined by checking with regex createReact(Component|)(ObjectName

## bug fixes
- Renaming File would not rename if dir did not exist.
  - Cleaning up empty directories when renaming.

# 2.3.0+

- Added Syntax Highlighting for React Properties and statics in Objects.
- Added Syntax Highlighting for next.js exports.
- Added First Quick Fix, more to come.
- Added First AutoComplete for Documentation.
- Fixed Getters and Setters. readonly will only show if not setter is paired with getter. setter will show up even without getter.
- Added Props parsing. Now will parse propTypes and add it to the typings file with Props appended to end of the name of the object.

## bug fixes
- Hints should not bring up prompt saying error occurred.
- When parsing props we need to prefer comments since we currently don't parse propTypes object.
- Prop variables sharing name with function would throw error.

# 2.2.0+

- Added notification to check log. Disabled if createDebugLog is false.
- Added support for getter and setters in Object Literal.
- Added ability to compile every js file in your project.
- Improved Error Reporting and logging.
- Auto Compile React Class.
- Nested Objects. Very useful for Creating the state object in React.
- Added the ability to compile on change.
- Improved Error reporting. Specify exact line error and warnings occur on for you to easily fix.
- Logging Errors that occure that aren't breaking to a log file in typings folder.

# 2.1.0+

- Added maintainHierarchy to settings.
- Improved parsing of create method.
- Compile to js to ts now working with inline array.
- Add static keyword.
- Problems being shown for you to fix.
- Create method being parsed for non static variables.

# 2.0.0+

- Command works now even if you dont have generateTypings set.
- Fixed typed file. interface needs to have a different name than the object for vscode to pick up.
- Add async and prevent breaking on nested functions
- Add ability to parse defaultValue in function paramaters.
- Compile a js file into a .d.ts file.
  - This will allow you to have intellisense throughout the whole project.
  - Activate auto compile with settings.

# Version 1

### 1.1.3 - 1.1.5

- Add highlighting for react keywords. proptypes, and defaultProptypes.
- Add highlighting for next keyword. getInitialProps.

### 1.1.1 - 1.1.2

- Fixed bug where create whould highlight in object literal comments.

## 1.1.0

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
