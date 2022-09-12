import { defineConfig } from 'tsup'

const isProduction = process.env.NODE_ENV === 'production'

export default defineConfig({
  define: {
    'process.env.VITEST': 'undefined',
  },
  minify: true,
  format: ['esm', 'cjs'],
  entry: ['./src/index.ts', './src/nuxt.ts'],
  clean: true,
  dts: isProduction,
  esbuildOptions(options) {
    if (isProduction)
      options.pure = ['console.log']
  },
})
