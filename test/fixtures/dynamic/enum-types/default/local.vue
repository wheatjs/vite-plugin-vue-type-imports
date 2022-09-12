<script lang="ts" setup>
// Weird output when using eslint, disable it temporarily
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
enum Foo {
  Bar,
  Baz,
  Qux,
}

interface Props {
  foo: Foo
}

defineProps<Props>()
</script>
