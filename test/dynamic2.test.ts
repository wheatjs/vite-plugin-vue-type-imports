import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transform } from '../src/core'
import { generatePresets } from './_presets'

describe('Dynamic', async () => {
    const files = await fg(['./fixtures/dynamic/**/*.vue'], { cwd: __dirname })
    const resolvedFiles = files.map(file => [file.replace(/.+\/fixtures\/dynamic\//, ''), file])

    describe.each(resolvedFiles)('%s', async (_, file) => {
        const code = await readFile(resolve(__dirname, file), 'utf-8')

        test.each(Object.entries(generatePresets(__filename)))('%s', async (_, options) => {
            const result = await transform(code, options)

            expect(result).toMatchSnapshot()
        })
    })
})
