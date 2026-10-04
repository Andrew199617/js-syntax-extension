jest.mock('node:fs/promises', () => require('fs').promises, { virtual: true });

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const configuration = require('../webpack.config');
const manifest = require('../package.json');

test('standalone build output includes every manifest-referenced local JSON validation schema', async () =>
{
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-build-assets-'));
    try
    {
        await configuration.plugins[0].prepareExtensionOutput({ outputOptions: { path: output } });
        const packaged = JSON.parse(await fs.readFile(path.join(output, 'package.json'), 'utf8'));
        expect(packaged.main).toBe('./extension.js');
        expect(packaged.contributes.jsonValidation).toEqual(manifest.contributes.jsonValidation);
        for(const validation of packaged.contributes.jsonValidation)
        {
            if(validation.url.startsWith('./'))
            {
                const copied = await fs.readFile(path.join(output, validation.url), 'utf8');
                const original = await fs.readFile(path.join(__dirname, '..', validation.url), 'utf8');
                expect(copied).toBe(original);
                expect(JSON.parse(copied).properties).toHaveProperty('formatting');
            }
        }
    }
    finally
    {
        await fs.rm(output, { recursive: true, force: true });
    }
});
