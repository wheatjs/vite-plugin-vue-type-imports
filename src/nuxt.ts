import VueTypeImports from './vite'

export default function (_inlineOptions: any, nuxt: any) {
  nuxt.hook('vite:extend', async (vite: any) => {
    vite.config.plugins = vite.config.plugins || []
    vite.config.plugins.unshift(VueTypeImports())
  })
}
