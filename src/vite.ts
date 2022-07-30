import { Plugin, ResolvedConfig } from 'vite';
import { CleanOptions, transform } from './core';

interface PluginOptions {
  clean?: CleanOptions;
}

export default function VitePluginVueTypeImports(options: PluginOptions = {}): Plugin {
  const clean = options.clean ?? {};
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    name: 'vite-plugin-vue-type-imports',
    enforce: 'pre',
    async configResolved(config) {
      resolvedConfig = config;
    },
    async transform(code, id) {
      if (!/\.(vue)$/.test(id)) return;

      const aliases = resolvedConfig?.resolve.alias;

      const transformedCode = await transform(code, {
        id,
        aliases,
        clean,
      });

      return {
        code: transformedCode,
      };
    },
  };
}
