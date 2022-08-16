<script lang="ts" setup>
import type { BaseProps } from './externals/3'

type Bar = number

type Foo = string

interface Props extends BaseProps {
  foo: Foo
  bar: Bar
  base: BaseProps
}

defineProps<Props>()
</script>
