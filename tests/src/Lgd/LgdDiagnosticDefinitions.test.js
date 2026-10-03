const LgdDiagnosticDefinitions = require('../../../src/Lgd/LgdDiagnosticDefinitions');

describe('LGD diagnostic definitions', () =>
{
    test.each([
        [ 'lgd.output.syntax', 'syntax' ],
        [ 'lgd.output.nativeSyntax', 'syntax' ],
        [ 'lgd.assignment.typeMismatch', 'type' ],
        [ 'lgd.return.typeMismatch', 'type' ],
        [ 'lgd.base.argumentCount', 'inheritance' ],
        [ 'lgd.override.required', 'inheritance' ],
        [ 'lgd.output.objectBase', 'inheritance' ],
        [ 'lgd.output.target', 'configuration' ]
    ])('keeps %s as internal identity while displaying only %s', (code, visibleCode) =>
    {
        const definition = LgdDiagnosticDefinitions.get({ code: code });
        expect(definition.internalId).toBe(code);
        expect(definition.visibleCode).toBe(visibleCode);
        expect(definition.source).toBe('LGD');
    });

    test('does not disguise an unproven emission fault as a source syntax error', () =>
    {
        const definition = LgdDiagnosticDefinitions.get({ code: 'lgd.output.syntax', category: 'compilation' });
        expect(definition.internalId).toBe('lgd.output.syntax');
        expect(definition.visibleCode).toBe('compilation');
    });

    test('has safe short fallbacks for uncoded and unregistered errors', () =>
    {
        expect(LgdDiagnosticDefinitions.get({ category: 'type' }).visibleCode).toBe('type');
        expect(LgdDiagnosticDefinitions.get({ code: 'lgd.future.internal' }).visibleCode).toBe('error');
        expect(LgdDiagnosticDefinitions.get({ severity: 'warning' }).visibleCode).toBe('warning');
        expect(LgdDiagnosticDefinitions.get({ code: '__proto__' }).visibleCode).toBe('error');
    });

    test('routes only authoritative metadata kinds associated with their stable diagnostic ID', () =>
    {
        const mismatch = { code: 'lgd.assignment.typeMismatch', quickFix: { kind: 'changeParameterType' } };
        expect(LgdDiagnosticDefinitions.fixKinds(mismatch)).toEqual([ 'changeParameterType', 'changeParameterAndReturnType' ]);
        expect(LgdDiagnosticDefinitions.fixKinds({ ...mismatch, quickFix: { kind: 'makeBaseVirtual' } })).toEqual([]);
        expect(LgdDiagnosticDefinitions.fixKinds({ ...mismatch, code: 'lgd.future.internal' })).toEqual([]);
        const definition = LgdDiagnosticDefinitions.get(mismatch);
        definition.fixKinds.push('unexpected');
        expect(LgdDiagnosticDefinitions.fixKinds(mismatch)).toEqual([ 'changeParameterType', 'changeParameterAndReturnType' ]);
    });
});
