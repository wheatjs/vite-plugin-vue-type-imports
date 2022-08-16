type Baz = boolean

type Bar = number

type Foo = string

type Qux = 'qux'

interface Base {
  qux: Qux
}

export interface BaseProps extends Base {
  baz: Baz
}

export interface Props extends BaseProps {
  foo: Foo
  bar: Bar
  base: BaseProps
}
