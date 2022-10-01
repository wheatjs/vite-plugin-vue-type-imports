<script lang="tsx" setup>
import type { Foo } from './_types'

interface Props {
  foo: Foo
}

defineProps<Props>()
</script>
