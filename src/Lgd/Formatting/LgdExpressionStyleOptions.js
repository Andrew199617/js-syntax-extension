/** @description Expression preferences are opt-in because these edits change executable tokens. */
const preferences = [ 'coalesce', 'nullPropagation', 'conditionalCall', 'booleanSimplification', 'compoundAssignment', 'inferredMemberNames', 'conditionalReturn', 'conditionalAssignment', 'interpolation' ];

/** @description Parentheses preferences distinguish the four standard operator categories. */
const parentheses = [ 'parenthesesArithmetic', 'parenthesesRelational', 'parenthesesOtherBinary', 'parenthesesOther' ];

/** @description Shared declarative catalog and compatibility mappings for guarded expression styles. */
const LgdExpressionStyleOptions = {
    catalog: {
        id: 'lgd.format.expressions', title: 'Expression styles',
        defaults: Object.fromEntries([ ...preferences, ...parentheses ].map(option => [ option, 'preserve' ])),
        properties: Object.fromEntries([
            ...preferences.map(option => [ option, { enum: [ 'preserve', 'prefer' ] } ]),
            ...parentheses.map(option => [ option, { enum: [ 'preserve', 'always_for_clarity', 'never_if_unnecessary' ] } ])
        ])
    },
    editorConfig: Object.fromEntries([
        [ 'dotnet_style_coalesce_expression', 'coalesce' ],
        [ 'dotnet_style_null_propagation', 'nullPropagation' ],
        [ 'csharp_style_conditional_delegate_call', 'conditionalCall' ],
        [ 'dotnet_style_prefer_simplified_boolean_expressions', 'booleanSimplification' ],
        [ 'dotnet_style_prefer_compound_assignment', 'compoundAssignment' ],
        [ 'dotnet_style_prefer_inferred_anonymous_type_member_names', 'inferredMemberNames' ],
        [ 'dotnet_style_prefer_conditional_expression_over_return', 'conditionalReturn' ],
        [ 'dotnet_style_prefer_conditional_expression_over_assignment', 'conditionalAssignment' ],
        [ 'dotnet_style_prefer_simplified_interpolation', 'interpolation' ],
        [ 'dotnet_style_parentheses_in_arithmetic_binary_operators', 'parenthesesArithmetic' ],
        [ 'dotnet_style_parentheses_in_relational_binary_operators', 'parenthesesRelational' ],
        [ 'dotnet_style_parentheses_in_other_binary_operators', 'parenthesesOtherBinary' ],
        [ 'dotnet_style_parentheses_in_other_operators', 'parenthesesOther' ]
    ])
};

module.exports = LgdExpressionStyleOptions;
