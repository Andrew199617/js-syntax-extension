/** @description Assignment operators have independent spacing and wrapping preferences. */
const assignments = new Set([ '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '&=', '|=', '^=' ]);

/** @description Only established binary operators participate in spacing fixes. */
const binaries = new Set([ '==', '!=', '===', '!==', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '**', '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>', 'in', 'instanceof' ]);

module.exports = { assignments: assignments, binaries: binaries };
