/* eslint-disable import/no-named-default */
import type { default as Bar, default as Foo } from './types/2'

export interface Props {
  foo: Foo
  bar: Bar
}
