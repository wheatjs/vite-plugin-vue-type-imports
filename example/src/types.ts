export interface User {
  name: string
}

export type GlobalEmits = {(e: 'show-toast', req: boolean): void, (e: 'loading', req: string): void}