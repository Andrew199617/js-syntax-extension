const RemoveReturnDocTypeFix = require('./RemoveReturnDocTypeFix');
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
    const handlers = [ new ReplaceReadonlyLocalFix(),
        new ConvertObjectInheritanceFix(),
        new ConvertObjectInheritanceFix(true),
        new AddOverrideFix(),
        new MakeBaseVirtualFix(),
        new RemoveExtraBaseArgumentsFix(),
        new ChangeParameterTypeFix(),
        new ChangeParameterAndReturnTypeFix(),
        new ChangeReturnTypeFix(),
        new UseStaticTypeReceiverFix(),
        new MoveVirtualModifierFix(),
        new RemoveReturnDocTypeFix() ];

    return new Map(handlers.map(handler => [ handler.kind, handler ]));
}

module.exports = createQuickFixRegistry;
