import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import colors from 'picocolors'
import _debug from 'debug'
import fg from 'fast-glob'
import { resolveModule } from 'local-pkg'
import type { Alias, AliasOptions } from 'vite'
import { babelParse, generateCodeFrame } from '@vue/compiler-sfc'
import type { CallExpression, Node, Program, TSEnumDeclaration, TSInterfaceDeclaration, TSTypeAliasDeclaration } from '@babel/types'
import type { ExtractedTypes, IExport, IImport } from './ast'
import { DEFINE_EMITS, DEFINE_PROPS, PLUGIN_NAME, TS_TYPES_KEYS, WITH_DEFAULTS } from './constants'

type Pkg = Partial<Record<'types' | 'typings', string>>

/**
 * Type name prefixed with path
 *
 * @example '/foo/bar/baz.ts:Props'
 */
export type NameWithPath = string

/**
 * The actual name of type. It may be prefixed by the plugin.
 *
 * @example
 * ```text
 * 1. 'Foo'
 * 2. '_VTI_TYPE_Foo'
 * 3. '_VTI_TYPE_Foo_2'
 * ```
 */
export type FullName = string

export type TSTypes = TSTypeAliasDeclaration | TSInterfaceDeclaration | TSEnumDeclaration

export type MaybeAliases = ((AliasOptions | undefined) & Alias[]) | undefined

export type MaybeString = string | null | undefined

export type MaybeNumber = number | null | undefined

export type MaybeNode = Node | null | undefined

/**
 * References:
 * https://github.com/tc39/proposal-relative-indexing-method#polyfill
 * https://github.com/antfu/utils/blob/main/src/array.ts
 */
export function at(arr: [], index: number): undefined
export function at<T>(arr: T[], index: number): T
export function at<T>(arr: T[] | [], index: number): T | undefined {
  const length = arr.length

  if (index < 0)
    index += length

  if (index < 0 || index > length || !length)
    return undefined

  return arr[index]
}

export function debuggerFactory(namespace: string) {
  return (name?: string) => {
    const _debugger = _debug(`${PLUGIN_NAME}:${namespace}${name ? `:${name}` : ''}`)

    /**
     * NOTE(zorin): Use `console.log` instead when testing.
     * Because the output of the default logger is incomplete (i.e. it will lost some debug messages) when testing.
     */
    if (process.env.VITEST) {
      /* eslint-disable-next-line no-console */
      _debugger.log = console.log.bind(console)
    }

    return _debugger
  }
}

const createUtilsDebugger = debuggerFactory('Utils')

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
  const modulePath = resolveModule(path === '.' ? './index' : path)
  const dtsRE = /.+\.d\.ts$/

  // Not a package. e.g. '../types'
  if (!modulePath)
    return join(dirname(from), path)

  // Result is a typescript declaration file. e.g. 'vue/macros-global.d.ts'
  if (dtsRE.test(modulePath)) {
    return modulePath
  }
  // Not a typescript file, find declaration file
  // TODO(zorin): Still needs to be improved
  else {
    const packageJsonPath = searchPackageJSON(modulePath)

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

export async function resolveModulePath(path: string, from: string, aliases?: MaybeAliases) {
  const debug = createUtilsDebugger('resolveModulePath')

  const maybePath = resolvePath(path, from, aliases)?.replace(/\\/g, '/')

  debug('Resolved path: %s', maybePath)

  if (!maybePath)
    return null

  let files = await fg([`${maybePath}`, `${maybePath}?(.d).ts`], {
    onlyFiles: true,
  })

  if (!files.length) {
    /**
     * NOTE(zorin): We only scan index(.d).ts when the result is empty, otherwise it may cause 'ENOTDIR' error
     */
    files = await fg([`${maybePath}/index?(.d).ts`], {
      onlyFiles: true,
    })
  }

  debug('Matched files: %O', files)

  if (files.length)
    return files[0]

  return null
}

export type LocationMap = Record<string, Pick<IImport, 'start' | 'end'>>

export interface ImportInfo {
  aliases: Record<string, string>
  locationMap: LocationMap
  localSpecifiers: string[]
}

export type GroupedImports = Record<string, ImportInfo>

/**
 * Categorize imports
 *
 * @example
 * ```
 * const code = `import { a as bb, b as cc, c as aa } from 'example'`
 * // ...(Operations of getting AST and imports)
 * const groupedImports = groupImports(imports);
 *
 * console.log(groupedImports)
 * // Result:
 * {
 *   example: {
 *     aliases: {
 *       bb: 'a',
 *       cc: 'b',
 *       aa: 'c'
 *     },
 *     locationMap: {...},
 *     localSpecifiers: ['bb', 'cc', 'aa']
 *   }
 * }
 * ```
 */
export function groupImports(imports: IImport[], source: string, fileName: string) {
  const importedSpecifiers: string[] = []

  return imports.reduce<GroupedImports>((res, rawImport) => {
    res[rawImport.path] ||= {
      aliases: {},
      locationMap: {},
      localSpecifiers: [],
    }

    if (importedSpecifiers.includes(rawImport.imported)) {
      warn(`Duplicate imports of type "${rawImport.imported}" found.`, {
        fileName,
        codeFrame: generateCodeFrame(source, rawImport.start, rawImport.end),
      })
    }

    const importInfo = res[rawImport.path]
    importInfo.localSpecifiers.push(rawImport.local)
    importInfo.locationMap[rawImport.local] = {
      start: rawImport.start,
      end: rawImport.end,
    }

    importedSpecifiers.push(rawImport.imported)

    if (rawImport.local !== rawImport.imported)
      importInfo.aliases[rawImport.local] = rawImport.imported

    return res
  }, {})
}

/**
 * Convert export syntaxes to import syntaxes
 *
 * @example
 * Source:
 * ```typescript
 * export { Foo } from 'foo'
 * ```
 * Result:
 * ```typescript
 * import { Foo } from 'foo'
 * export { Foo }
 * ```
 */
export function convertExportsToImports(exports: IExport[], groupedImports: GroupedImports): IImport[] {
  const debug = createUtilsDebugger('convertExportsToImports')

  // localSpecifier -> modulePath
  const specifiersMap = Object.entries(groupedImports).reduce<Record<string, string>>((res, [modulePath, importInfo]) => {
    importInfo.localSpecifiers.forEach((s) => {
      res[s] = modulePath
    })

    return res
  }, {})

  debug('Specifiers map: %O', specifiersMap)

  return exports.map(({ start, end, local, exported, path }) => {
    if (path || specifiersMap[local]) {
      const mappedPath = specifiersMap[local]
      let imported = local

      if (!path && isString(mappedPath))
        imported = groupedImports[mappedPath].aliases[local] || local

      return {
        start,
        end,
        local: exported,
        imported,
        path: path || mappedPath,
      }
    }

    return null
  }).filter(notNullish)
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
 *
 * NOTE(zorin): We assume that each replacement selection does not overlap with each other
 */
export function replaceAtIndexes(source: string, replacements: Replacement[], offset = 0): string {
  replacements.sort((a, b) => b.start - a.start)
  let result = source

  for (const node of replacements)
    result = result.slice(0, node.start + offset) + node.replacement + result.slice(node.end + offset)

  return result.split(/\r?\n/).filter(Boolean).join('\n')
}

/**
 * Collect dependencies and flatten it by using BFS
 *
 * NOTE(zorin): Maybe this needs a better solution.
 *
 * @example
 * Source code:
 * ```
 * type Foo = string;
 * type Bar = Foo;
 *
 * export interface Props {
 *   foo: Foo;
 *   bar: Bar;
 * }
 * ```
 * Dependency graph:
 * ```
 * Props ---Foo
 *       |--Bar--Foo
 * ```
 * Result: ['Foo', 'Bar', 'Props']
 */
export function resolveDependencies(extracted: ExtractedTypes, namesMap: Record<FullName, NameWithPath>, dependencies: string[]): string[] {
  function _resolveDependencies() {
    // NOTE(zorin): I don't think users will use same type for defineProps and defineEmits, so currently we do not dedupe them
    const queue: string[] = dependencies
    const result: string[] = []

    while (queue.length) {
      const shift = queue.shift()!

      const key = namesMap[shift]

      /**
       * Skip adding dependency
       *
       * NOTE(zorin): The only situation I know is invalid type (Types that are not even found after the recursion completes)
       */
      if (!key) {
        warn(`Invalid type found: ${shift}`)
        continue
      }

      result.push(key)

      const dependencies = extracted.get(key)!.dependencies

      if (dependencies?.length) {
        // Dedupe dependencies
        new Set(dependencies).forEach(dep => queue.push(dep))
      }
    }

    return result
  }

  // Dedupe from the end
  return [...new Set(_resolveDependencies().reverse())]
}

/**
 * Generate correct order of extension by using BFS. Similar to `resolveDependencies`
 *
 * NOTE(zorin): Maybe this needs a better solution.
 */
export function resolveExtends(record: Record<string, string[]>) {
  function _resolveExtends() {
    const queue: string[] = Object.keys(record)
    const result: string[] = []

    while (queue.length) {
      const shift = queue.shift()!

      result.push(shift)

      const extendTypes = record[shift]

      if (extendTypes?.length)
        extendTypes.forEach(key => queue.push(key))
    }

    return result
  }

  // Dedupe from the end
  const result = [...new Set(_resolveExtends().reverse())]

  return result
}

export function isNumber(n: MaybeNumber): n is number {
  return typeof n === 'number' && n.toString() !== 'NaN'
}

export function isString(n: MaybeString): n is string {
  return typeof n === 'string'
}

export function isCallOf(node: MaybeNode, test: string | ((id: string) => boolean)): node is CallExpression {
  return !!(
    node
    && node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && (typeof test === 'string' ? node.callee.name === test : test(node.callee.name))
  )
}

export function isTSTypes(node: MaybeNode): node is TSTypes {
  return !!(node && TS_TYPES_KEYS.includes(node.type))
}

export function notNullish<T>(val: T | null | undefined): val is NonNullable<T> {
  return val != null
}

export interface LogOptions {
  fileName?: string
  codeFrame?: string
}

export function mergeLogMsg(options: LogOptions & { msg: string }) {
  const { msg, fileName, codeFrame } = options

  // NOTE(zorin): We only log basic message in test
  const result = [
    msg,
    '',
    process.env.VITEST ? undefined : fileName,
    process.env.VITEST ? undefined : codeFrame,
  ].filter(notNullish)

  // Push newline if the last line is not an empty string
  if (at(result, -1))
    result.push('')

  return result.join('\n')
}

export function warn(msg: string, { fileName, codeFrame }: LogOptions = {}) {
  const result = mergeLogMsg({ msg, fileName, codeFrame })

  console.warn(colors.yellow(`[${PLUGIN_NAME}] WARN: ${result}`))
}

export function error(msg: string, { fileName, codeFrame }: LogOptions = {}): never {
  const result = mergeLogMsg({ msg, fileName, codeFrame })

  throw new Error(colors.red(`[${PLUGIN_NAME}] ERROR: ${result}`))
}

export function isEnum(node: TSTypes | null | undefined): node is TSEnumDeclaration {
  return !!(node && node.type === 'TSEnumDeclaration')
}

export const isDefineProps = (node: Node): node is CallExpression => isCallOf(node, DEFINE_PROPS)
export const isDefineEmits = (node: Node): node is CallExpression => isCallOf(node, DEFINE_EMITS)
export const isWithDefaults = (node: Node): node is CallExpression => isCallOf(node, WITH_DEFAULTS)
