<h2 align="center">vite-plugin-vue-type-imports</h2>

<p align="center">
  Enables you to import types and use them in your <code>defineProps</code> and <code>defineEmits</code>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/vite-plugin-vue-type-imports" target="__blank"><img src="https://img.shields.io/npm/v/vite-plugin-vue-type-imports?color=a356fe&label=Version" alt="NPM version"></a>
</p>

> ⚠️ This Plugin is still in Development and there may be bugs. Use at your own risk.

## Install
```bash
# Install Plugin
npm i -D vite-plugin-vue-type-imports
```

```ts
// vite.config.ts

import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueTypeImports from 'vite-plugin-vue-type-imports'

export default defineConfig({
  plugins: [
    Vue(), 
    VueTypeImports({/* options */}),
  ],
})
```

### Nuxt
```ts
// nuxt.config.ts

export default {
  buildModules: [
    'vite-plugin-vue-type-imports/nuxt',
  ]
}
```

## Usage

```ts
// types.ts

export interface User {
  username: string
  password: string
  avatar?: string
}
```

```html
<script setup lang="ts">
import type { User } from '~/types'

defineProps<User>()
</script>

<template>...</template>
```

## Options
```typescript
VueTypeImports({
  // Non-practical function
  // Just for those who want to get a nice output
  clean: {
    // Clean redundant newlines ("\n")
    newline: false,
    // Clean isolated interfaces which are replaced by a new interface created by the plugin
    interface: false,
  }
})
```

## Known limitations
- The following syntaxes are not supported currently:
  - `import default`
  - `import { a as b }`
  - `export default`
  - `export * from`
- nested type parameters (e.g. `defineProps<Props<T>>()`) are not supported.
- ~~At this stage, the plugin only scans the imported interfaces and does not process the interfaces defined in the SFC~~ Supported in the next release.
- ~~HMR is not fully supported right now.~~ Fixed in the next release.
- Interface which extends Literal Type or Intersection Type is not supported.
- Types imported from external packages are not fully supported right now.
- When interfaces implicitly rely on interfaces with the same name but different structures, the results may be different from what is expected.

## Notes
- `Enum` types will be converted to Union Types (e.g. `type [name] = number | string`) , since Vue can't handle them right now.
- The plugin may be slow because it needs to traverse the AST (using @babel/parser).

## License

[MIT License](https://github.com/jacobclevenger/vite-plugin-vue-gql/blob/main/LICENSE) © 2021-PRESENT [Jacob Clevenger](https://github.com/jacobclevenger)
