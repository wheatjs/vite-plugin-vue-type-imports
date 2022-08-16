<script lang="ts" setup>
type Foo = number

type Bar = Foo

type Baz = Bar

type Qux = Foo

interface Props {
  foo: Foo
  bar: Bar
  baz: Baz
  qux: Qux
}

defineProps<Props>()
</script>
