/**
 * A small running-total calculator written in LGD.
 * Exercises typed declarations, JSDoc, and arrow functions
 * across the JavaScript, TypeScript, and C# backends.
 */

/** Display name shown in reports.
 * @type {string}
 */
const calculatorName = "LGD Calculator";

/** Running total of all calculations.
 * @type {number}
 */
let total = 0;

/** True once any calculation has run.
 * @type {boolean}
 */
let hasRun = false;

/** Totals recorded after each operation.
 * @type {any[]}
 */
let history = [];

/** Records a total in the history.
 * @type {Function}
 */
let record = (value) => {
    history.push(value);
};

/** Adds a value to the running total.
 * @type {Function}
 */
export let add = (value) => {
    /** @type {number} */
    let next = total + value;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/** Multiplies the running total by a factor.
 * @type {Function}
 */
export let multiply = (factor) => {
    /** @type {number} */
    let next = total * factor;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/** Resets the calculator to its initial state.
 * @type {Function}
 */
export let reset = () => {
    total = 0;
    hasRun = false;
    history = [];
    return total;
};

/** Describes the current calculator state.
 * @type {Function}
 */
export let describe = () => {
    /** @type {string} */
    let state = hasRun ? "used" : "fresh";
    return calculatorName + " is " + state + " with total " + total;
};
