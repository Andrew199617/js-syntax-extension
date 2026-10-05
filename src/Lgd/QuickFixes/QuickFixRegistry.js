const RemoveRedundantCastFix = require('./RemoveRedundantCastFix');
const RenameClassConstructorFix = require('./RenameClassConstructorFix');
const ReplaceConstructorReturnThisFix = require('./ReplaceConstructorReturnThisFix');
const RemoveReturnDocTypeFix = require('./RemoveReturnDocTypeFix');
const RemoveInheritanceDocFix = require('./RemoveInheritanceDocFix');
const FormattingFix = require('./FormattingFix');
const LgdFormattingPolicy = require('../Fixes/LgdFormattingPolicy');
const ReplaceReadonlyLocalFix = require('./ReplaceReadonlyLocalFix');
const ConvertObjectInheritanceFix = require('./ConvertObjectInheritanceFix');
const ChangeParameterAndReturnTypeFix = require('./ChangeParameterAndReturnTypeFix');
const ChangeReturnTypeFix = require('./ChangeReturnTypeFix');
const ChangeParameterTypeFix = require('./ChangeParameterTypeFix');
const AddOverrideFix = require('./AddOverrideFix');
const MakeBaseVirtualFix = require('./MakeBaseVirtualFix');
const RemoveExtraBaseArgumentsFix = require('./RemoveExtraBaseArgumentsFix');
const UseStaticTypeReceiverFix = require('./UseStaticTypeReceiverFix');
const MoveVirtualModifierFix = require('./MoveVirtualModifierFix');

/** @description Creates the diagnostic strategy registry; future fixes register one isolated handler here. */
function createQuickFixRegistry()
{
    const handlers = [
        { handler: new RemoveRedundantCastFix(), ruleId: 'unnecessary-reference-cast', automatic: true },
        { handler: new RenameClassConstructorFix(), ruleId: 'class-constructor-name' },
        { handler: new ReplaceConstructorReturnThisFix(), ruleId: 'constructor-return-value', automatic: true },
        { handler: new ReplaceReadonlyLocalFix(), ruleId: 'readonly-variable-declaration', automatic: true },
        { handler: new RemoveReturnDocTypeFix(), ruleId: 'return-type-documentation', automatic: true },
        { handler: new RemoveInheritanceDocFix(), ruleId: 'inheritance-documentation', automatic: true },
        { handler: new MoveVirtualModifierFix(), ruleId: 'virtual-documentation', automatic: true },
        { handler: new ConvertObjectInheritanceFix(), ruleId: 'object-inheritance' },
        { handler: new ConvertObjectInheritanceFix(true), ruleId: 'object-inheritance', individualOnly: true },
        { handler: new AddOverrideFix(), ruleId: 'missing-override' },
        { handler: new MakeBaseVirtualFix(), ruleId: 'nonvirtual-base' },
        { handler: new RemoveExtraBaseArgumentsFix(), ruleId: 'extra-base-arguments' },
        { handler: new ChangeParameterTypeFix(), ruleId: 'parameter-type' },
        { handler: new ChangeParameterAndReturnTypeFix(), ruleId: 'parameter-type', individualOnly: true },
        { handler: new ChangeReturnTypeFix(), ruleId: 'return-type' },
        { handler: new UseStaticTypeReceiverFix(), ruleId: 'static-member-receiver' }
    ];

    for(const rule of LgdFormattingPolicy.rules())
    {
        handlers.push({ handler: new FormattingFix(rule), ruleId: rule.id, parentRuleId: rule.parentRuleId, automatic: true });
    }

    return new Map(handlers.map(entry =>
    {
        const { handler, ...policy } = entry;
        Object.assign(handler, policy);
        return [ handler.kind, handler ];
    }));
}

module.exports = createQuickFixRegistry;
