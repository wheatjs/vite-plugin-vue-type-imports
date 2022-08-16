<script lang="ts" setup>
type Bar = Foo

type Foo = number

interface Props {
  foo: Foo
  bar: Bar
}

defineProps<Props>()
</script>
