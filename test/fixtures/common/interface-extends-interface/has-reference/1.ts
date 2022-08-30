type Baz = boolean

type Bar = number

type Foo = string

export interface BaseProps {
  baz: Baz
}

export interface Props extends BaseProps {
  foo: Foo
  bar: Bar
}
