# LGD accessibility implementation and verification

## Compilation identity

`LgdProjectIdentity.resolve({ sourcePath, projectId })` is asynchronous and shared by editor and file-compilation paths. It returns a canonical `sourcePath` and an opaque `projectId`.

- A nonempty explicit `projectId` defines a caller-managed compilation unit.
- Otherwise, the nearest actual `lgdconfig.json` or `package.json` file defines the project. A colocated LGD manifest wins over a package manifest. The identity is the canonical manifest filename, not its JSON contents.
- Sources without a manifest use a per-source identity. Anonymous or inaccessible paths have no established cross-file identity and cannot grant internal access.
- Existing and not-yet-created source paths canonicalize through real filesystem ancestors. Dangling links and access failures fail closed.
- Workspace roots and `tsconfig.json`/`jsconfig.json` do not establish LGD membership. Their include/exclude/reference rules are not approximated.

A compiler embedding can use the same resolver before its synchronous compilation call:

```js
const identity = await LgdProjectIdentity.resolve({ sourcePath });
const result = compiler.compileToJs(source, externals, {
    ...identity,
    javascriptObjectModel: 'oloo'
});
```

Resolve the defining file independently when constructing external export metadata. Never assign the importing file's project ID to its dependencies. The language service does this automatically and carries its compilation identity through quick-fix previews. Callers may deliberately supply the same explicit project ID to multiple files; they own that compilation boundary.

## Identity and checking

Local access uses actual lexical declarations. Exported ownership uses canonical source paths and declaration-name offsets. Imported aliases and unrelated same-named classes cannot become owners. Source identity is separate from the navigation provenance field so a local declaration is not mistaken for an imported one.

The existing mapped Babel AST/member registry checks reads, writes, fixed computed names, known aliases, explicit construction and factories. A separate lexical class lookup supplies private/protected privilege inside ordinary nested functions, without changing the registry's `this` rules. Named destructuring uses the same access rule. Type-only internal interface imports are checked before erasure.

Exported ancestry preserves protected access through multiple imported base classes. A source-backed nominal type table carries typed fields and method-result identities across files without resolving their annotation names in the consumer's scope. Export signatures include visibility, constructor/accessor access, type tables and project identity. Dependency invalidation therefore responds to visibility-only changes as well as name/type changes.

The metadata remains available in `allDeclarations` for both JavaScript object models. Access modifiers do not install runtime access wrappers or ES private fields. The existing LGD save path writes JavaScript; this feature does not add a new declaration-file output mode.

## Deliberate boundaries

- Existing implicit public defaults are preserved. C# defaults would be a breaking language change.
- The current relative CommonJS resolver follows direct `require` bindings and `module.exports = NamedType`. This feature does not add ESM named-export or package-resolution support.
- Top-level types accept public/internal. Class members accept all four single modifiers. Combined modifiers and nested LGD member-type declarations are not added.
- Interface signatures are public contracts; modern C#'s additional interface-member accessibility forms are not implemented.
- Existing backend limitations, including native-class inherited instance-field initialization, remain unchanged.
- Unknown dynamic property names, reflective writes/calls, externally supplied untyped values, and unresolved/circular nominal information remain conservative. Accessibility is a compile-time contract, not runtime secrecy.

## C# comparison

The design was checked with 43 actual Roslyn compilations using .NET SDK 10.0.401, including separate library/consumer assemblies. Representative analogous results:

| Case | C# result | LGD rule |
| --- | --- | --- |
| Private access through another same-class instance or a nested function | Allowed | Allowed |
| Derived method accesses protected member through base-typed/sibling receiver | CS1540 | Rejected |
| Derived method accesses protected static member through base type | Allowed | Allowed |
| Protected base constructor in a base initializer | Allowed | Allowed |
| Derived method separately constructs protected base | CS0122 | Rejected for `new` and `.create()` |
| Override widens inherited accessibility | CS0507 | Rejected |
| Private virtual member | CS0621 | Rejected |
| Interface implementation method is private | CS0737 | Rejected |
| Public class implements internal interface | Allowed | Allowed within its project |
| Public class inherits internal class / public interface inherits internal interface | CS0060 / CS0061 | Rejected |
| Public/protected signature exposes an internal type | Accessibility error | Rejected |
| Internal containing class has public members using internal types | Allowed | Allowed |
| Internal type/member accessed from another assembly | Accessibility error | Rejected across LGD projects |

References: [C# protected access](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts#744-protected-access), [accessibility constraints](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts#745-accessibility-constraints), [restricting accessor accessibility](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/restricting-accessor-accessibility).

## Regression coverage

Focused suites cover parser spans/conflicts, both JavaScript output modes, private/protected/internal access, separate getter/setter access, factories/base constructors, overrides/interface obligations, signature exposure, aliases and same-named classes, chained imported types, erased interfaces, incremental export edits, manifest changes, symlinks, editor cancellation, hovers, completion filtering and semantic/TextMate scopes. Run the complete Jest suite, project lint and build before publication. Native editor color rendering still requires the normal workspace-trust approval; automated token tests do not replace that UI proof.
