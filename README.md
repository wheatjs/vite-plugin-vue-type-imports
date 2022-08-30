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
    VueTypeImports(),
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

## Known limitations
- The following syntaxes are not supported currently:
  - `import * as Foo from 'foo'`
  - `export * from 'foo'`
- [These types](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html) are not supported.
- Types imported from external packages are not fully supported right now.
- The plugin currently only scans the content of `<script setup>`. Types defined in `<script>` will be ignored.

## Notes
- `Enum` types will be converted to Union Types (e.g. `type [name] = number | string`) , since Vue can't handle them right now.
- The plugin may be slow because it needs to read files and traverse the AST (using @babel/parser).

## Caveats
It is not recommended to write **duplicate** imports/exports. It may affect the result of the plugin's transformation. You will get warnings if the plugin detects this kind of code.

Examples:

```javascript
// These kinds of code will trigger warnings from the plugin
import { Foo, Foo as Bar } from 'foo'

import { Foo as Bar, Foo as Baz } from 'foo'

export { Foo, Foo as Bar }

export { Foo as Bar, Foo as Baz }

export { Foo, Foo as Bar } from 'foo'

export { Foo as Bar, Foo as Baz } from 'foo'
```

## License

[MIT License](https://github.com/jacobclevenger/vite-plugin-vue-gql/blob/main/LICENSE) © 2021-PRESENT [Jacob Clevenger](https://github.com/jacobclevenger)
