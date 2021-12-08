import VueTypeImports from './vite'

export default function(this: any) {
  this.nuxt.hook('vite:extend', async(vite: any) => {
    vite.config.plugins = vite.config.plugins || []
    vite.config.plugins.unshift(VueTypeImports())
  })
}
