# Guarded expression styles

Expression preferences belong to `formatting.options.expressions` (or the
`options` object of `rules["lgd.format.expressions"]`). Each preference also has
an independent `lgd.format.expressions.<option>` severity/fix policy. They are
opt-in: the default is `preserve`. A false imported Boolean preference maps to
`preserve`; it does not expand concise code into a different form. The explicit `lambdaBodies` preference instead offers `always`, `when_on_single_line`, and `never` for reversible arrow body style.

## Supported forms

| Option | Values | Guarded behavior |
| --- | --- | --- |
| `parenthesesArithmetic` | `preserve`, `always_for_clarity`, `never_if_unnecessary` | Mixed nested arithmetic operators are grouped. Removal must preserve the complete parsed tree. |
| `parenthesesRelational` | same | Comparison/equality operators use a separate preference. |
| `parenthesesOtherBinary` | same | Logical/bitwise and remaining binary operators use a separate preference. |
| `parenthesesOther` | same | Unnecessary nonbinary parentheses are removed only with equal parsed semantics. There is no added grouping for atomic expressions. |
| `coalesce` | `preserve`, `prefer` | A conditional checking a local against both `null` and `void 0` becomes `??`. |
| `nullPropagation` | same | A checked local's property/index read with a `void 0` fallback becomes optional access. A value-producing sequence retains detached-call and delete semantics. |
| `conditionalCall` | same | A local delegate call guarded against both `null` and `void 0` becomes an optional call. |
| `booleanSimplification` | same | Opposite Boolean-literal ternary branches become `!!condition` or `!condition`; JavaScript truthiness conversion is preserved. |
| `compoundAssignment` | same | `local = local <binary> value` becomes compound assignment. `??=` additionally requires a writable local and a fallback without anonymous-function/class name inference. |
| `inferredMemberNames` | same | Plain object-literal `name: name` becomes shorthand. |
| `conditionalReturn` | same | Two single-return branches become one conditional return. |
| `conditionalAssignment` | same | Two plain assignments to the same local become a conditional assignment, except anonymous values with assignment-inferred names. |
| `lambdaBodies` | `preserve`, `always`, `when_on_single_line`, `never` | A block containing exactly one value-return becomes a parenthesized concise expression; never expands concise expressions into a single-return block. Directives, comments, missing return values and unmapped typed arrow syntax are barriers. Full compiler diagnostics, declared contracts and normalized runtime AST must remain unchanged. |
| `interpolation` | same | Primitive literal substitutions in untagged templates become escaped literal text. Other substitutions retain their evaluation order. |

The exported compatibility map lists the corresponding `dotnet_style_*` and
`csharp_style_conditional_delegate_call` properties. Severity and fix mode are
handled separately by the common formatting policy.

## Deliberately unchanged

- Single-null checks and loose `== null` checks: these are not generally
  equivalent to JavaScript nullish operators (including `document.all`).
- Repeated property getters, calls, global names, and dynamic lookup through
  `with` or direct `eval`: evaluation count or reference lookup could change.
- A fallback of `null` when optional access returns `undefined`.
- Member/element assignment targets: reference evaluation can be observable.
- Object patterns, computed member names, and the `__proto__` setter.
- Tagged templates, custom conversion calls, and nonliteral interpolation.
- Branches with declarations, extra statements, or anonymous assignment values
  whose inferred function/class names would change.
- Required grouping, optional-chain boundaries, strict-mode directives,
  comments, formatting-off regions, malformed source, or compiler-generated
  source ranges.
- Tuple-element inference, C# reference-equality helper replacement, C# null
  type-check/pattern rewrites, and C# interpolation alignment/format clauses:
  these have no supported equivalent syntax or sufficient proof in this pass.

An unsafe or unsupported form produces no edit. These conservative guarantees
are intentional; importing a similarly named C# preference does not authorize
changing JavaScript coercion, nullability, evaluation count, or receiver binding.

`csharp_style_expression_bodied_lambdas` maps true to `always`, false to `never`,
and `when_on_single_line` to the corresponding native mode. Single-line mode
requires a single-line expression; it does not claim a hard line-width guarantee.
Conversions preserve lexical `this`/`arguments`, async behavior, operand evaluation
and object/sequence expression grouping. Comments and existing directives are never
moved or deleted. A file with compiler errors is left unchanged by this conversion.
