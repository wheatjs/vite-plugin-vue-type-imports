import type { Foo } from './types/1'
import type { Bar } from './types/2'

type A = Bar

export interface Props {
  foo: Foo
  bar: Bar
  baz: A
}
