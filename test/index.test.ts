import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fg from 'fast-glob';
import { transform, TransformOptions } from "~/core";

function normalizeName(val: string): string {
    const result = val.replace(/-/g, ' ');
    return result[0].toUpperCase() + result.slice(1)
}

function generateCode(path: string): string {
    return `<script lang="ts" setup>
import { Props } from '${path}'

defineProps<Props>()
</script>
`
}

const presets: Record<string, TransformOptions> = {
    'default': { id: __filename, clean: {} },
    'clean newline': { id: __filename, clean: { newline: true } },
    'clean interface': { id: __filename, clean: { interface: true } },
    'clean all': { id: __filename, clean: { newline: true, interface: true } }
};

const excludeFilesAndDirs = ['index.test.ts', '__snapshots__']

// pattern: "// Description (Extra description)"
const singleLineCommentRE = /^\/\/\s([^\(\)]+)(\((.+)\))?/g

const directories = new Set(await readdir(__dirname));

excludeFilesAndDirs.forEach(val => directories.delete(val));

// NOTE: Relative paths
const resolvedDirs = [...directories];

for (const dir of resolvedDirs) {
    const files = await fg(`${dir}/**/*.ts`, { cwd: __dirname })

    describe(normalizeName(dir), async () => {
        for (const filePath of files) {
            let description = '';
            let extraDescription = '';

            const firstLine = (await readFile(resolve(__dirname, filePath), 'utf-8')).split('\n')[0];
            const comment = firstLine.matchAll(singleLineCommentRE)

            for (const m of comment) {
                description = m[1].trim();
                extraDescription = m[3];
            }

            for (const [presetName, options] of Object.entries(presets)) {
                const extraDescriptionArray = [extraDescription, `Option: ${presetName}`].filter(Boolean);

                const testName = `${description} (${extraDescriptionArray.join(', ')})`

                test(testName, async () => {
                    const result = await transform(generateCode(filePath), options);

                    expect(result).toMatchSnapshot();
                })
            }
        }
    })
}
