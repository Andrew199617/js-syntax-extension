const fs = require('fs').promises;
const LgdEnumConversion = require('../src/Compilers/LgdEnumConversion');

/** @description Writes a selected enum conversion to stdout without changing the input file. */
async function main()
{
    const [ filePath, ...names ] = process.argv.slice(2);
    if(!filePath || names.length === 0)
    {
        throw new Error('Usage: node scripts/convert-enums.js input.js EnumName [OtherEnumName]');
    }

    const source = await fs.readFile(filePath, 'utf8');
    const result = LgdEnumConversion.toLgd(source, names);
    if(result.errors.length > 0 || result.skipped.length > 0)
    {
        throw new Error(`No output written. Could not safely convert: ${result.skipped.join(', ')}. ${result.errors.join(' ')}`);
    }

    process.stdout.write(result.code);
}

main().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});
