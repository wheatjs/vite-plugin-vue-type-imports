import type { CodeGetter } from './_utils'
import { defineTransformTest } from './_utils'

const codeGetter: CodeGetter = ({ entry }) => `<script lang="ts" setup>
import { Props } from '${entry}'

defineProps<Props>()
</script>
`

defineTransformTest({
  category: 'Common',
  filePattern: ['./fixtures/common/**/!(_)*.ts'],
  fileName: __filename,
  codeGetter,
  skip: false,
})
