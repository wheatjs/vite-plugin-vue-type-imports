import { Plugin, ResolvedConfig } from 'vite'
import { transform } from './core/src'

interface Store {
  config: ResolvedConfig | null
}

const store: Store = {
  config: null,
}

export default function VitePluginVueTypeImports(): Plugin {
  return {
    name: 'vite-plugin-vue-type-imports',
    enforce: 'pre',
    async configResolved(config) {
      store.config = config
    },
    async transform(code, id) {
      if (!/\.(vue)$/.test(id))
        return

      const root = store.config?.root
      const aliases = store.config?.resolve.alias

      return {
        code: await transform(code, {
          id,
          root,
          aliases,
        }),
      }
    },
  }
}
