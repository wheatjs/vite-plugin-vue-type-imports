import fs from 'node:fs/promises'
import { AliasOptions, Alias } from 'vite'
import { parse, babelParse } from '@vue/compiler-sfc'
import { Identifier } from '@babel/types'
import generate from '@babel/generator'
import { getUsedInterfacesFromAst, getAvailableImportsFromAst, extractTypesFromSource } from './ast'
import { resolveModulePath, replaceAtIndexes, Replacement, groupImports, intersect } from './utils'

export interface TransformOptions {
  id: string
  root: string | undefined
  aliases: ((AliasOptions | undefined) & Alias[]) | undefined
}

export async function transform(code: string, options: TransformOptions) {
  const { descriptor: { scriptSetup } } = parse(code)

  if (scriptSetup?.lang !== 'ts' || !scriptSetup.content)
    return code

  const ast = babelParse(scriptSetup.content, { sourceType: 'module', plugins: ['typescript', 'topLevelAwait'] })
  const { imports, importNodes: fullImports } = getAvailableImportsFromAst(ast.program)
  const interfaces = getUsedInterfacesFromAst(ast.program)

  /**
   * For every interface used in defineProps or defineEmits, we need to match
   * it to an import and then load the interface from the import and inline it
   * at the top of the vue script setup.
   */
  const resolvedTypes = (await Promise.all(Object.entries(groupImports(imports))
    .map(async([url, importedTypes]) => {
      const intersection = intersect(importedTypes, interfaces)
      const path = await resolveModulePath(url, options.id, options.aliases)

      if (path) {
        const data = await fs.readFile(path, 'utf-8')
        const types = (await extractTypesFromSource(data, intersection, {
          relativePath: path,
          aliases: options.aliases,
        })).reverse()

        return types
      }

      return null
    })))
    .flat()
    .filter(x => x) as [string, string][]

  const replacements: Replacement[] = []

  // Clean up imports
  fullImports.forEach((i) => {
    i.specifiers = i.specifiers.filter((specifier) => {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier')
        return !resolvedTypes.some(x => x[0] === (specifier.imported as Identifier).name)

      return true
    })

    if (i.specifiers.length === 0) {
      replacements.push({
        start: i.start!,
        end: i.end!,
        replacement: '',
      })
    }
    else {
      replacements.push({
        start: i.start!,
        end: i.end!,
        replacement: generate(i).code,
      })
    }
  })

  const transformedScriptSetup = [resolvedTypes.map(x => x[1]).join('\n'), replaceAtIndexes(scriptSetup.content, replacements)].join('\n')
  const transformedCode = [
    code.substring(0, scriptSetup.loc.start.offset),
    transformedScriptSetup,
    code.substring(scriptSetup.loc.end.offset),
  ].join('\n')

  return transformedCode
}
