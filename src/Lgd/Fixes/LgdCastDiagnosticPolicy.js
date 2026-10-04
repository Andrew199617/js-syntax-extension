/** @description Applies only the optional redundant-reference-cast presentation policy, never compiler safety errors. */
const LgdCastDiagnosticPolicy = {
    /** @description Keeps fix authorization separate from imported or native diagnostic visibility. */
    apply(errors, configuration)
    {
        const severity = configuration?.valid ? configuration.rules?.['unnecessary-reference-cast']?.severity : undefined;
        return errors.flatMap(error =>
        {
            if(error.code !== 'lgd.cast.redundant' || !severity)
            {
                return [error];
            }

            return severity === 'off' ? [] : [{ ...error, severity: severity }];
        });
    }
};

module.exports = LgdCastDiagnosticPolicy;
