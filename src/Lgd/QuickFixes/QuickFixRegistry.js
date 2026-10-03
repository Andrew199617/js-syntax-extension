const ConvertObjectInheritanceFix = require('./ConvertObjectInheritanceFix');
const ChangeParameterAndReturnTypeFix = require('./ChangeParameterAndReturnTypeFix');
const ChangeReturnTypeFix = require('./ChangeReturnTypeFix');
const ChangeParameterTypeFix = require('./ChangeParameterTypeFix');
const AddOverrideFix = require('./AddOverrideFix');
const MakeBaseVirtualFix = require('./MakeBaseVirtualFix');
const RemoveExtraBaseArgumentsFix = require('./RemoveExtraBaseArgumentsFix');
const UseStaticTypeReceiverFix = require('./UseStaticTypeReceiverFix');

/** @description Creates the diagnostic strategy registry; future fixes register one isolated handler here. */
function createQuickFixRegistry()
{
    const handlers = [ new ConvertObjectInheritanceFix(),
        new AddOverrideFix(),
        new MakeBaseVirtualFix(),
        new RemoveExtraBaseArgumentsFix(),
        new ChangeParameterTypeFix(),
        new ChangeParameterAndReturnTypeFix(),
        new ChangeReturnTypeFix(),
        new UseStaticTypeReceiverFix() ];

    return new Map(handlers.map(handler => [ handler.kind, handler ]));
}

module.exports = createQuickFixRegistry;
