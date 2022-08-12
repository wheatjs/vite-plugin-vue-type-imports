// Interface extends interface, no reference
export interface BaseProps {
  baz: boolean
}

export interface Props extends BaseProps {
  foo: string
  bar: number
}
