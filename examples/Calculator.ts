/**
 * A small running-total calculator written in LGD.
 * Exercises typed declarations, JSDoc, and arrow functions
 * across the JavaScript, TypeScript, and C# backends.
 */

/** Display name shown in reports. */
const calculatorName: string = "LGD Calculator";

/** Running total of all calculations. */
let total: number = 0;

/** True once any calculation has run. */
let hasRun: boolean = false;

/** Totals recorded after each operation. */
let history: any[] = [];

/** Records a total in the history. */
let record: Function = (value: number) => {
    history.push(value);
};

/** Adds a value to the running total. */
export let add: Function = (value: number) => {
    let next: number = total + value;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/** Multiplies the running total by a factor. */
export let multiply: Function = (factor: number) => {
    let next: number = total * factor;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/** Resets the calculator to its initial state. */
export let reset: Function = () => {
    total = 0;
    hasRun = false;
    history = [];
    return total;
};

/** Describes the current calculator state. */
export let describe: Function = () => {
    let state: string = hasRun ? "used" : "fresh";
    return calculatorName + " is " + state + " with total " + total;
};
