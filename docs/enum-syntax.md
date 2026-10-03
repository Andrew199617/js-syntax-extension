# Explicit-value enums

LGD enums are named, frozen JavaScript value objects. They preserve serialized values rather than renumbering them.

```lgd
export enum DownloadState {
    Progress = 'progress',
    Started = 'started',
    Failed = 'failed',
    Completed = 'completed',
}

DownloadState current = DownloadState.Started;
String wireValue = current;
```

Both JavaScript output modes (`oloo` and `class`) emit the same runtime object:

```js
/** @typedef {typeof DownloadState[keyof typeof DownloadState]} DownloadState */
export const DownloadState = Object.freeze({
    Progress: 'progress',
    Started: 'started',
    Failed: 'failed',
    Completed: 'completed',
});
```

`export` is optional. The typedef is editor-only; it has no runtime cost. The direct TypeScript backend emits the same frozen object and a `type` alias. Neither JavaScript mode creates a reverse numeric mapping.

## Version-one boundary

- Every member needs an explicit string or finite numeric literal; negative numeric literals are supported
- All members in one enum use the same primitive type
- Duplicate member names, `__proto__`, computed names, methods, arbitrary expressions, flags expressions, template literals, and implicit numeric numbering are unsupported
- Duplicate **values** are allowed and retained
- Like other current LGD declarations, put the declaration at the start of a line (indentation is fine)
- Enums can appear in ordinary lexical blocks; they are not class fields or nested class declarations
- The existing LGD nullable assignment policy remains unchanged
- Unknown dynamic member keys remain unknown rather than producing a guessed error

The compiler checks known missing members, direct assignment/update/delete of enum members, assignments to the enum binding, and nominal enum value assignments. The enum object itself is not an enum member value. Member values can be used as their underlying `String` or `Number` type. Enum members and typed variables feed the existing typed-parameter and return checks. This is intentionally not a complete C# enum type system.

Hover shows names and their literal values. Completion shows the members. Declaration/name/member source mappings retain editor navigation positions. The `enum` keyword uses the same declaration-keyword family as `class` and `interface`; its type name uses the existing type color. Resolved relative imports carry enum metadata and retain known-member checking.

## Narrow, explicit JavaScript conversion

There is no general project upgrader in this release. The reusable `LgdEnumConversion.toLgd(source, names)` helper only converts declarations explicitly named by its caller. It validates a `const Name = Object.freeze({ ... })` shape with plain identifier keys and homogeneous literal values. An arbitrary frozen settings object is never automatically designated an enum.

For a reviewable conversion, run this command from the repository:

```sh
node scripts/convert-enums.js path/to/source.js DownloadState > path/to/review.lgd
```

Use a **different output path**. The command reads the source and writes stdout; shell redirection to the input path would truncate that file before Node starts. If any requested name is unsupported, the command exits unsuccessfully and writes no converted stdout. The source file is never modified by the command itself.

Shadowed `Object`, mutable bindings, dynamic values, spreads, getters, duplicate keys, computed/string keys, mixed value types, inline declarations, and wrapper comments requiring uncertain rewriting are retained unchanged by the helper and listed in `skipped`. Comments inside the object, literal spellings, exports and values are preserved. The helper shares the compiler's literal parser, and compiler-generated typedefs are recognized and removed during reverse conversion so repeated round trips do not accumulate aliases.

Conversion is deliberately limited to enum declarations. It does not turn unrelated JavaScript variable annotations, classes, functions, or project files into LGD syntax. Use the existing LGD compiler for the forward LGD-to-JavaScript direction.

## Actual C# comparison

A real Roslyn compiler and .NET runtime were used with isolated fixtures:

| Case | C# result | LGD result |
| --- | --- | --- |
| Explicit numeric `Started = 1, Completed = 2` | Compiles and runs, printing `1`, `2` | Supported; values remain `1`, `2` |
| Implicit `Started, Completed` | Compiles and runs, printing `0`, `1` | Rejected; no implicit numbering in this version |
| Explicit strings `Started = "started"` | Rejected with `CS0029` | Supported; preserves serialized strings |

String-valued LGD enums are **not C# enums**. C# enum members have integral underlying types. The experimental C# backend now reports an explicit unsupported-enum diagnostic rather than claiming this source is valid C# output. This comparison does not claim a working C# backend.

The delivery evidence includes fixture sources, compiler identity, exact compiler/run results, real editor captures and nearby explanations. Repository regression tests cover runtime values, both JavaScript modes, direct TypeScript output, comments/escapes, source maps, invalid syntax, lexical shadowing, enum value types, imported aliases, editor updates, and conservative round-trip conversion.
