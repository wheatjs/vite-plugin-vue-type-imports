import { dirname, join } from 'node:path'
import { AliasOptions, Alias } from 'vite'
import fg from 'fast-glob'
import { IImport } from './ast'

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
  const importeeHasSlashAfterKey = importee.substring(pattern.length)[0] === '/'
  return importeeStartsWithKey && importeeHasSlashAfterKey
}

export function resolvePath(path: string, from: string, aliases: ((AliasOptions | undefined) & Alias[]) | undefined) {
  const matchedEntry = aliases?.find(entry => matches(entry.find, path))

  if (matchedEntry)
    return path.replace(matchedEntry.find, matchedEntry.replacement)

  return join(dirname(from), path)
}

export async function resolveModulePath(path: string, from: string, aliases: ((AliasOptions | undefined) & Alias[]) | undefined) {
  const maybePath = resolvePath(path, from, aliases)
  const files = await fg(`${maybePath.replace(/\\/g, '/')}*.+(ts|d.ts)`, { onlyFiles: true })

  if (files.length > 0)
    return files[0]

  return null
}

export function groupImports(imports: IImport[]) {
  return imports.reduce((r, a) => {
    r[a.path] = r[a.path] || []
    r[a.path].push(a.imported)

    return r
  }, {} as Record<string, string[]>)
}

export function intersect(a: Array<any>, b: Array<any>) {
  const setB = new Set(b)
  return [...new Set(a)].filter(x => setB.has(x))
}

export interface Replacement {
  start: number
  end: number
  replacement: string
}

/**
 * Replace all items at specified indexes while keeping indexes relative during replacements.
 */
export function replaceAtIndexes(source: string, replacements: Replacement[]) {
  let offset = 0

  for (const node of replacements) {
    if (node) {
      source = source.slice(0, node.start + offset) + node.replacement + source.slice(node.end + offset)
      offset += node.replacement.length - (node.end - node.start)
    }
  }

  return source
}
