import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transform } from '../src/core'
import { generatePresets } from './_presets'

function generateCode(entry: string) {
    return `<script lang="ts" setup>
import { Props } from '${entry}'

defineProps<Props>()
</script>
`
}

describe('Common', async () => {
    const files = await fg(['./fixtures/common/**/!(_)*.ts'], { cwd: __dirname })
    const resolvedFiles = files.map(file => [file.replace(/.+\/fixtures\/common\//, ''), file])

    describe.each(resolvedFiles)('%s', (_, file) => {
        const code = generateCode(file);

        test.each(Object.entries(generatePresets(__filename)))('%s', async (_, options) => {
            const result = await transform(code, options)

            expect(result).toMatchSnapshot()
        })
    })
})
