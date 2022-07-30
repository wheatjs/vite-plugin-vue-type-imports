import { defineConfig } from 'tsup';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  minify: true,
  format: ['esm', 'cjs'],
  entry: ['./src/index.ts', './src/nuxt.ts'],
  target: 'node14',
  clean: true,
  external: ['fast-glob', '@babel/types', 'local-pkg'],
  dts: isProduction,
  esbuildOptions(options) {
    if (isProduction) {
      options.pure = ['console.log'];
    }
  },
});
