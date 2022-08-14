import { existsSync, readFileSync } from 'fs'
import { dirname, extname, join } from 'path'
import fg from 'fast-glob'
import { resolveModule } from 'local-pkg'
import type { Alias, AliasOptions } from 'vite'
import { babelParse } from '@vue/compiler-sfc'
import type { Program } from '@babel/types'
import type { IImport } from './ast'

type Pkg = Partial<Record<'types' | 'typings', string>>

export type StringMap = Map<string, string>

export type MaybeAliases = ((AliasOptions | undefined) & Alias[]) | undefined

export function getAst(content: string): Program {
  return babelParse(content, {
    sourceType: 'module',
    plugins: ['typescript', 'topLevelAwait'],
  }).program
}

/**
 * Source: https://github.com/rollup/plugins/blob/master/packages/alias/src/index.ts
 */
export function matches(pattern: string | RegExp, importee: string) {
  if (pattern instanceof RegExp)
    return pattern.test(importee)

  if (importee.length < pattern.length)
    return false

  if (importee === pattern)
    return true

  const importeeStartsWithKey = importee.indexOf(pattern) === 0
  const importeeHasSlashAfterKey = importee.slice(pattern.length)[0] === '/'
  return importeeStartsWithKey && importeeHasSlashAfterKey
}

// https://github.com/antfu/local-pkg/blob/main/index.mjs
export function searchPackageJSON(dir: string): string | undefined {
  let packageJsonPath
  while (true) {
    if (!dir)
      return
    const newDir = dirname(dir)
    if (newDir === dir)
      return

    dir = newDir
    packageJsonPath = join(dir, 'package.json')
    if (existsSync(packageJsonPath))
      break
  }

  return packageJsonPath
}

export function resolvePath(path: string, from: string, aliases: MaybeAliases) {
  const matchedEntry = aliases?.find(entry => matches(entry.find, path))

  // Path which is using aliases. e.g. '~/types'
  if (matchedEntry)
    return path.replace(matchedEntry.find, matchedEntry.replacement)

  /**
   * External package
   * If the path is just a single dot, append '/index' to prevent incorrect results
   */
  const resolved_path = resolveModule(path === '.' ? `${path}/index` : path)

  // Not a package. e.g. '../types'
  if (!resolved_path)
    return join(dirname(from), path)

  // Result is a typescript file. e.g. 'vue/macros-global.d.ts'
  if (extname(resolved_path) === '.ts') {
    return resolved_path
  }
  // Not a typescript file, find declaration file
  // The only situation is that the types are imported from the main entry. e.g. 'vue' -> 'vue/dist/vue.d.ts'
  else {
    const packageJsonPath = searchPackageJSON(resolved_path)

    if (!packageJsonPath)
      return

    const { types, typings } = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Pkg

    let result: string | undefined

    try {
      // @ts-expect-error allow result to be undefined
      result = join(dirname(packageJsonPath), types || typings)
    }
    catch {}

    return result
  }
}

export async function resolveModulePath(path: string, from: string, aliases: MaybeAliases) {
  const maybePath = resolvePath(path, from, aliases)?.replace(/\\/g, '/')

  if (!maybePath)
    return null

  const files = await fg([`${maybePath}`, `${maybePath}*.+(ts|d.ts)`, `${maybePath}*/index.+(ts|d.ts)`], {
    onlyFiles: true,
  })

  if (files.length)
    return files[0]

  return null
}

/**
 * @returns Record<string, string[]> - key: the imported file, value: imported fields
 */
export function groupImports(imports: IImport[]) {
  return imports.reduce<Record<string, string[]>>((obj, importInfo) => {
    obj[importInfo.path] = obj[importInfo.path] || []
    obj[importInfo.path].push(importInfo.imported)

    return obj
  }, {})
}

export function intersect<A = any, B = any>(a: Array<A>, b: Array<B>): (A | B)[] {
  const setB = new Set(b)
  // @ts-expect-error unnecessary type checking (for now)
  return [...new Set(a)].filter(x => setB.has(x))
}

export interface Replacement {
  start: number
  end: number
  replacement: string
}

/**
 * Replace all items at specified indexes from the bottom up.
 */
export function replaceAtIndexes(source: string, replacements: Replacement[], clean = false): string {
  replacements.sort((a, b) => b.start - a.start)
  let result = source

  for (const node of replacements)
    result = result.slice(0, node.start) + node.replacement + result.slice(node.end)

  // remove empty newline -> ''
  if (clean) {
    result = result
      .split('\n')
      .filter(val => val)
      .join('\n')
  }

  return result
}

export function insertString(source: string, start: number, insertVal: string): string {
  return source.slice(0, start) + insertVal + source.slice(start)
}
