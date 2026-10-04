/** @description Makes a failed editor refresh visible on its current source document and in the output channel. */
async function reportEditorFailure(service, document, error)
{
    const state = document ? service.getState(document.uri) : null;
    if(state && state.document === document)
    {
        state.errors = [{ offset: 0, endOffset: 0, code: 'lgd.editor.failure', category: 'compilation',
            message: 'Language features could not be refreshed. Reopen this file or check the LGD output for details.' }];
        await service.publishDiagnostics(state);
    }

    service.onError(error);
}

/** @description Observes an update rejection, reports it against its document, and keeps subsequent updates runnable. */
async function settleEditorUpdate(service, promise, document)
{
    try
    {
        await promise;
    }
    catch(error)
    {
        await reportEditorFailure(service, document, error);
    }
}

module.exports = settleEditorUpdate;
