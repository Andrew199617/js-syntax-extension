const ChangeParameterTypeFix = require('./ChangeParameterTypeFix');
const AddOverrideFix = require('./AddOverrideFix');
const MakeBaseVirtualFix = require('./MakeBaseVirtualFix');
const RemoveExtraBaseArgumentsFix = require('./RemoveExtraBaseArgumentsFix');

/** @description Creates the diagnostic strategy registry; future fixes register one isolated handler here. */
function createQuickFixRegistry()
{
    const handlers = [ new AddOverrideFix(), new MakeBaseVirtualFix(), new RemoveExtraBaseArgumentsFix(), new ChangeParameterTypeFix() ];
    return new Map(handlers.map(handler => [ handler.kind, handler ]));
}

module.exports = createQuickFixRegistry;
