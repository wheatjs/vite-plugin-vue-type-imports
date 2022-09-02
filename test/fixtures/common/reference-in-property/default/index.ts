interface Foo {
  foo: 'foo'
}

type Bar = Foo

export interface Props {
  foo: Foo
  bar: Bar
}
