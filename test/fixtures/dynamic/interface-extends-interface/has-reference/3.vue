<script lang="ts" setup>
type Baz = boolean

type Bar = number

type Foo = string

type Qux = 'qux'

interface Base {
  qux: Qux
}

interface BaseProps extends Base {
  baz: Baz
}

interface Props extends BaseProps {
  foo: Foo
  bar: Bar
  base: BaseProps
}

defineProps<Props>()
</script>
