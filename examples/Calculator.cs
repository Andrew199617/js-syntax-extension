// Generated from an LGD source file by the LGD compiler (C# backend v0.2.0).
// v1 mock: typed declarations are translated to C#. Other statements pass
// through with light rewrites (.push -> .Add, === -> ==, = [] -> new List).
// export modifiers are dropped: this file uses top-level statements.
using System;
using System.Collections.Generic;
/**
 * A small running-total calculator written in LGD.
 * Exercises typed declarations, JSDoc, and arrow functions
 * across the JavaScript, TypeScript, and C# backends.
 */

/// <summary>Display name shown in reports.</summary>
const string calculatorName = "LGD Calculator";

/// <summary>Running total of all calculations.</summary>
double total = 0;

/// <summary>True once any calculation has run.</summary>
bool hasRun = false;

/// <summary>Totals recorded after each operation.</summary>
List<dynamic> history = new List<dynamic> { };

/// <summary>Records a total in the history.</summary>
Action<double> record = (double value) => {
    history.Add(value);
};

/// <summary>Adds a value to the running total.</summary>
Func<double, dynamic> add = (double value) => {
    double next = total + value;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/// <summary>Multiplies the running total by a factor.</summary>
Func<double, dynamic> multiply = (double factor) => {
    double next = total * factor;
    total = next;
    hasRun = true;
    record(next);
    return next;
};

/// <summary>Resets the calculator to its initial state.</summary>
Func<dynamic> reset = () => {
    total = 0;
    hasRun = false;
    history = new List<dynamic>();
    return total;
};

/// <summary>Describes the current calculator state.</summary>
Func<dynamic> describe = () => {
    string state = hasRun ? "used" : "fresh";
    return calculatorName + " is " + state + " with total " + total;
};
