// Interface extends interface (No references)
export interface BaseProps {
    baz: boolean;
}

export interface Props extends BaseProps {
    foo: string;
    bar: number;
}
