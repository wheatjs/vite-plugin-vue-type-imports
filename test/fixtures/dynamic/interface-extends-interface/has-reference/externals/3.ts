type Baz = boolean

type Qux = 'qux'

interface Base {
  qux: Qux
}

export interface BaseProps extends Base {
  baz: Baz
}
