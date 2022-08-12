<script lang="ts" setup>
interface BaseProps {
  baz: boolean
}

interface Props extends BaseProps {
  foo: string
  bar: number
}

defineProps<Props>()
</script>
