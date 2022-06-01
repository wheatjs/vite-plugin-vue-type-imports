type Foo = [[number, number], [number, number]];
type Bar = Foo;

export interface Props {
  foo: Foo;
  bar: Bar;
}
