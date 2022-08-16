import type { TransformOptions } from '../src/core'

export const presetNames = ['default'] as const

export type PresetNames = typeof presetNames[number]

export type Presets = Record<PresetNames, TransformOptions>

export function generatePresets(id: string): Presets {
  return {
    default: { id },
  }
}
