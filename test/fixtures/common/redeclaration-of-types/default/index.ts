// https://github.com/wheatjs/vite-plugin-vue-type-imports/issues/6
export type Foo = [number, number]

export interface Props {
  foo: Foo
  bar: Foo
}
