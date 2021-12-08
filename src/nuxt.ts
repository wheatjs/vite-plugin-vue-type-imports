import { extendViteConfig } from '@nuxt/kit'
import VueTypeImports from './vite'

export default {
  setup() {
    extendViteConfig((config) => {
      config.plugins = config.plugins || []
      config.plugins.unshift(VueTypeImports())
    })
  },
}
