<script lang="ts" setup>
type Baz = boolean

type Bar = number

type Foo = string

interface BaseProps {
  baz: Baz
}

interface Props extends BaseProps {
  foo: Foo
  bar: Bar
}

defineProps<Props>()
</script>
