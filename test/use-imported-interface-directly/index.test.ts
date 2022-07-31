import { transform, TransformOptions } from '~/core'

function generateCode(testPath: string) {
    return `
    <script lang="ts" setup>
    import { Props } from './${testPath}'
    
    defineProps<Props>()
    </script>
    `
}

const options: TransformOptions = { id: __filename, clean: {} }

test('Redeclaration of types #6', async () => {
    const result = await transform(generateCode('redeclaration-of-types'), options)

    expect(result).toMatchSnapshot()
});

test('Interface which has no references', async () => {
    const result = await transform(generateCode('no-reference-interface'), options)

    expect(result).toMatchSnapshot()
});

test('Interface extends interface (No references)', async () => {
    const result = await transform(generateCode('interface-extends-interface'), options)

    expect(result).toMatchSnapshot()
});
