import type { Plugin as Plugin_2 } from 'vite'
import { parse, babelParse } from '@vue/compiler-sfc'
import { getAvailableImportsFromAst, getUsedInterfacesFromAst } from './utils'
import { resolve, dirname, extname } from 'path'
import { createMatchPath, MatchPath } from 'tsconfig-paths'
import * as fs from 'fs/promises'
import fg from 'fast-glob'
import { existsSync } from 'fs'

interface LocalCache {
  matcher: MatchPath
  paths: null
}

const cache: LocalCache = {
  paths: null,
  matcher: createMatchPath(resolve('.'), {})
}

interface Plugin extends Plugin_2 {
  name: string
}

export default function VitePluginVueTypeImports(): Plugin {
  return {
    name: 'vite-plugin-vue-type-imports',
    enforce: 'pre',
    async config() {
      const tsconfig = JSON.parse(await fs.readFile('tsconfig.json', 'utf-8'))
      cache.paths = tsconfig?.compilerOptions?.paths
      cache.matcher = createMatchPath(resolve('.'), cache.paths || {})
    },
    async transform(code: string, id: string) {
      if (!id.endsWith('vue'))
        return null

      const { descriptor: { scriptSetup } } = parse(code)

      if (scriptSetup?.lang !== 'ts' || !scriptSetup?.content)
        return null

      const ast = babelParse(scriptSetup.content, { sourceType: 'module', plugins: ['typescript', 'topLevelAwait'] })
      const availableImports = getAvailableImportsFromAst(ast.program)
      const usedInterfaces = getUsedInterfacesFromAst(ast.program)
      const removeImports: { start: number, end: number }[] = []
      let injected = ``

      for (const imp of availableImports) {
        if (usedInterfaces.includes(imp.local)) {
          const path = cache.matcher(imp.path) || resolve(dirname(id), imp.path)
          const hasExtension = !!extname(path)
          let currentFile: string | undefined

          
          // If the file has an extension already, then we can just check if it exists and load it.
          if (hasExtension) {
            if (existsSync(path)) {
              currentFile = await fs.readFile(path, 'utf-8')
            }
          } else {
            const files = await fg(`${path.replace(/\\/g, '/')}*.+(ts|d.ts)`, { onlyFiles: true })

            if (files.length > 0)
              currentFile = await fs.readFile(files[0], 'utf-8')
          }


          // Found correct file to load interface from
          if (currentFile) {
            const fileAst = babelParse(currentFile, { sourceType: 'module', plugins: [ 'typescript', 'topLevelAwait' ] })

            for (const node of fileAst.program.body) {
              if (node.type === 'ExportNamedDeclaration') {
                if (node.declaration?.type === 'TSInterfaceDeclaration') {
                  if (node.declaration.id.name === imp.imported) {
                    injected += currentFile.substring(node.declaration.start!, node.declaration.end!).replace(`interface ${imp.imported}`, `interface ${imp.local}`)
                    removeImports.push({ start: imp.start, end: imp.end })
                  }
                } else if (node.declaration?.type === 'TSTypeAliasDeclaration') {
                  if (node.declaration.id.name === imp.imported) {
                    injected += currentFile.substring(node.declaration.start!, node.declaration.end!).replace(`type ${imp.imported}`, `type ${imp.local}`)
                    removeImports.push({ start: imp.start, end: imp.end })
                  }
                } else if (node.declaration?.type === 'TSEnumDeclaration') {
                  if (node.declaration.id.name === imp.imported) {
                    injected += currentFile.substring(node.declaration.start!, node.declaration.end!).replace(`enum ${imp.imported}`, `enum ${imp.local}`)
                    removeImports.push({ start: imp.start, end: imp.end })
                  }
                }
              }
            }
          }
        }
      }

      let newScript = scriptSetup.content
      let offset = 0

      for (const remove of removeImports) {
        newScript = newScript.substring(0, remove.start - offset) + newScript.substring(remove.end - offset + 1)
        offset += remove.end - remove.start
      }

      return {
        code: code.replace(scriptSetup.content, `\n${injected}\n${newScript}`)
      }
    }
  }
}
