import { MoreColors } from '~/test'

export type Color = 'blue' | 'red' | MoreColors

export interface ButtonProps {
  color: Color
}
