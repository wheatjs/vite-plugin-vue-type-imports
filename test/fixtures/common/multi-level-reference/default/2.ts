type Foo = number

type Bar = Foo

type Baz = Bar

type Qux = Foo

export interface Props {
  foo: Foo
  bar: Bar
  baz: Baz
  qux: Qux
}
