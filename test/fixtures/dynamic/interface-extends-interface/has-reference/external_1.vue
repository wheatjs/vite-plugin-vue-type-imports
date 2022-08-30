<script lang="ts" setup>
import type { BaseProps } from './externals/1'

type Bar = number

type Foo = string

interface Props extends BaseProps {
  foo: Foo
  bar: Bar
}

defineProps<Props>()
</script>
