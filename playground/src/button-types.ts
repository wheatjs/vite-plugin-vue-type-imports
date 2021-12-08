import { Color } from './other-types'
export { ButtonProps } from './other-types'

export interface InputProps {
  name: Color
}

export interface ButtonEmits {
  (e: 'click'): void
}
