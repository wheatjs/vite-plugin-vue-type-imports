<script lang="tsx" setup>
interface Props {
  foo: string
}

defineProps<Props>()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const render = () => <div />
</script>
