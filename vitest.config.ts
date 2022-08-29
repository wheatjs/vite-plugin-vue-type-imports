import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    target: 'node14',
  },
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    globals: true,
  },
})
