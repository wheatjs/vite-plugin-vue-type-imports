<script lang="ts" setup>
import type { BaseProps } from './index'

interface Props extends BaseProps {
  foo: string
  bar: number
}

defineProps<Props>()
</script>
