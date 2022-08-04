import { TransformOptions } from "../src/core";

export type Presets = Record<string, TransformOptions>

export function generatePresets(id: string): Presets {
    return {
        'default': { id, clean: {} },
        'clean newline': { id, clean: { newline: true } },
        'clean interface': { id, clean: { interface: true } },
        'clean all': { id, clean: { newline: true, interface: true } }
    }
}
