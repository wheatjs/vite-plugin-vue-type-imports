import path from 'path'
import { defineConfig } from 'vite'
import VueTypeImports from 'vite-plugin-vue-type-imports'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '~/': `${path.resolve(__dirname, 'src')}/`,
    },
  },
  plugins: [
    vue(),
    VueTypeImports(),
  ]
})
