import { defineTransformTest, CodeGetter } from './_utils'

const codeGetter: CodeGetter = ({ entry }) => `<script lang="ts" setup>
import { Props } from '${entry}'

defineProps<Props>()
</script>
`

await defineTransformTest({
    category: 'Common',
    filePattern: ['./fixtures/common/**/!(_)*.ts'],
    fileName: __filename,
    codeGetter,
})
