import type { Plugin, ResolvedConfig } from 'vite'
import { transform } from './core'
import { PLUGIN_NAME } from './core/constants'

export default function VitePluginVueTypeImports(): Plugin {
  let resolvedConfig: ResolvedConfig | undefined

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',
    async configResolved(config) {
      resolvedConfig = config
    },
    async transform(code, id) {
      if (!/\.(vue)$/.test(id))
        return

      const aliases = resolvedConfig?.resolve.alias

      const transformResult = await transform(code, {
        id,
        aliases,
      })

      return transformResult
    },
  }
}
