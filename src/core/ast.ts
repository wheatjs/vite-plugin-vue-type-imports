/* eslint-disable @typescript-eslint/no-use-before-define */
import fs from 'fs'
import type {
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  Node,
  Program,
  TSEnumDeclaration,
  TSExpressionWithTypeArguments,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  TSTypeLiteral,
  TSTypeParameterInstantiation,
  TSTypeReference,
  TSUnionType,
} from '@babel/types'
import type {
  FullName,
  GroupedImportsResult,
  MaybeAliases,
  MaybeNumber,
  NameWithPath,
  Replacement,
  TSTypes,
} from './utils'
import {
  at,
  convertExportsToImports,
  debuggerFactory,
  getAst,
  groupImports,
  isDefineEmits,
  isDefineProps,
  isEnum,
  isNumber,
  isString,
  isTSTypes,
  isWithDefaults,
  resolveModulePath,
} from './utils'

const enum Prefixes {
  Default = '_VTI_TYPE_',
  Empty = '',
}

export interface IImport {
  start: number
  end: number
  local: string
  imported: string
  path: string
}

export interface IExport {
  start: number
  end: number
  local: string
  exported: string
  path?: string
}

/**
 * @example
 * ```typescript
 * export { Foo }
 * ```
 */
export type INamedExport = Omit<IExport, 'path'>

/**
 * @example
 * ```typescript
 * export { Foo } from 'foo'
 * ```
 */
export type INamedFromExport = Required<IExport>

export type TypeInfo = Partial<Record<'type' | 'name', string>>

export type GetTypesResult = (string | TypeInfo)[]

export interface GetImportsResult {
  imports: IImport[]
  importNodes: ImportDeclaration[]
}

export interface GetExportsResult {
  namedExports: INamedExport[]
  namedFromExports: INamedFromExport[]
  exportAllSources: string[]
}

export type NodeMap = Map<string, TSTypes>

const createAstDebugger = debuggerFactory('AST')

export function getAvailableImportsFromAst(ast: Program): GetImportsResult {
  const imports: IImport[] = []
  const importNodes: ImportDeclaration[] = []

  const addImport = (node: ImportDeclaration) => {
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        imports.push({
          start: specifier.imported.start!,
          end: specifier.local.end!,
          imported: specifier.imported.name,
          local: specifier.local.name,
          path: node.source.value,
        })
      }
      else if (specifier.type === 'ImportDefaultSpecifier') {
        imports.push({
          start: specifier.local.start!,
          end: specifier.local.end!,
          imported: 'default',
          local: specifier.local.name,
          path: node.source.value,
        })
      }
    }

    importNodes.push(node)
  }

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && node.specifiers.length && node.source.value)
      addImport(node)
  }

  return { imports, importNodes }
}

export function getAvailableExportsFromAst(ast: Program): GetExportsResult {
  const namedExports: INamedExport[] = []
  const namedFromExports: INamedFromExport[] = []
  const exportAllSources: string[] = []

  const addExport = (node: ExportNamedDeclaration) => {
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
        if (node.source) {
          namedFromExports.push({
            start: specifier.local.start!,
            end: specifier.exported.end!,
            exported: specifier.exported.name,
            local: specifier.local.name,
            path: node.source.value,
          })
        }
        else {
          namedExports.push({
            start: specifier.local.start!,
            end: specifier.exported.end!,
            exported: specifier.exported.name,
            local: specifier.local.name,
          })
        }
      }
    }
  }

  const addDefaultExport = (node: ExportDefaultDeclaration) => {
    if (node.declaration.type === 'Identifier') {
      namedExports.push({
        start: node.declaration.start!,
        end: node.declaration.end!,
        exported: 'default',
        local: node.declaration.name,
      })
    }
  }

  for (const node of ast.body) {
    // TODO(zorin): support export * from
    if (node.type === 'ExportNamedDeclaration')
      addExport(node)
    else if (node.type === 'ExportDefaultDeclaration')
      addDefaultExport(node)
    else if (node.type === 'ExportAllDeclaration')
      exportAllSources.push(node.source.value)
  }

  return {
    namedExports,
    namedFromExports,
    exportAllSources,
  }
}

export function getUsedInterfacesFromAst(ast: Program) {
  const interfaces: string[] = []

  const addInterface = (node: Node) => {
    if (node.type === 'CallExpression' && node.typeParameters?.type === 'TSTypeParameterInstantiation') {
      const propsTypeDefinition = node.typeParameters.params[0]

      if (propsTypeDefinition.type === 'TSTypeReference' && propsTypeDefinition.typeName.type === 'Identifier')
        interfaces.push(propsTypeDefinition.typeName.name)

      // TODO(zorin): Support nested type params
      // if (propsTypeDefinition.typeParameters)
      //     interfaces.push(...getTypesFromTypeParameters(propsTypeDefinition.typeParameters));
    }
  }

  for (const node of ast.body) {
    if (node.type === 'ExpressionStatement') {
      if (isWithDefaults(node.expression))
        addInterface(node.expression.arguments[0])
      else if (isDefineProps(node.expression) || isDefineEmits(node.expression))
        addInterface(node.expression)
    }

    if (node.type === 'VariableDeclaration' && !node.declare) {
      for (const decl of node.declarations) {
        if (decl.init) {
          if (isWithDefaults(decl.init))
            addInterface(decl.init.arguments[0])
          else if (isDefineProps(decl.init) || isDefineEmits(decl.init))
            addInterface(decl.init)
        }
      }
    }
  }

  return interfaces
}

function getTypesFromTypeParameters(x: TSTypeParameterInstantiation) {
  const types: GetTypesResult = []

  for (const p of x.params) {
    if (p.type === 'TSTypeLiteral') { types.push(...getTSTypeLiteralTypes(p)) }
    else if (p.type === 'TSTypeReference') {
      if (p.typeName.type === 'Identifier')
        types.push(p.typeName.name)
    }
  }

  return types
}

function getTSTypeLiteralTypes(x: TSTypeLiteral) {
  const types: GetTypesResult = []

  for (const m of x.members) {
    if (m.type === 'TSPropertySignature') {
      if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeLiteral') {
        types.push(...getTSTypeLiteralTypes(m.typeAnnotation.typeAnnotation))
      }
      else if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeReference') {
        if (m.typeAnnotation.typeAnnotation.typeName.type === 'Identifier') {
          // TODO(zorin): understand why we push a object
          types.push({
            type: m.typeAnnotation.typeAnnotation.type,
            name: m.typeAnnotation.typeAnnotation.typeName.name,
          })
        }

        if (m.typeAnnotation.typeAnnotation.typeParameters)
          types.push(...getTypesFromTypeParameters(m.typeAnnotation.typeAnnotation.typeParameters))
      }
      else {
        types.push({ type: m.typeAnnotation?.typeAnnotation.type })
      }
    }
  }

  return types
}

function extractAllTypescriptTypesFromAST(ast: Program): Record<'local' | 'exported', TSTypes[]> {
  const local: TSTypes[] = []
  const exported: TSTypes[] = []

  ast.body
    .forEach((node) => {
      // e.g. 'export interface | type | enum'
      if (node.type === 'ExportNamedDeclaration' && node.declaration && isTSTypes(node.declaration)) {
        local.push(node.declaration)
        exported.push(node.declaration)
      }

      // e.g. 'interface | type | enum'
      if (isTSTypes(node))
        local.push(node)
    })

  return {
    local,
    exported,
  }
}

export interface LocalTypeMetaData {
  // The source type which reference current type
  referenceSource?: string
  // The interface which extends current interface
  extendTarget?: string
  // Whether it is used in vue macros
  isUsedType?: boolean
  hasDuplicateImports?: boolean
}

export interface ReplacementRecord {
  target: FullName
  source: NameWithPath
}

export type TypeMetaData = Omit<LocalTypeMetaData, 'referenceSource'> & {
  replacementTargets?: ReplacementRecord[]
}

export type ReferenceTypeMetaData = LocalTypeMetaData & { referenceSource: NameWithPath }

export interface ExtractedTypeReplacement {
  offset: number
  replacements: Replacement[]
}

export interface ExtractedTypeInfo {
  typeKeyword: 'type' | 'interface'
  fullName: string
  body: string
  dependencies?: string[]
}

export type ExtractedTypes = Map<NameWithPath, ExtractedTypeInfo>

export interface ExtractTypesFromSourceOptions {
  relativePath: string
  pathAliases: MaybeAliases
  metaDataMap: Record<string, TypeMetaData>
  extractAliases?: Record<string, string>
  // Data shared across recursions
  extraSpecifiers?: string[]
  extractedKeysCounter?: Record<string, number>
  extractedNamesMap?: Record<FullName, NameWithPath>
  extractedTypes?: ExtractedTypes
  extractedTypeReplacements?: Record<NameWithPath, ExtractedTypeReplacement>
  interfaceExtendsRecord?: Record<NameWithPath, string[]>
  // SFC only (i.e. Arguments passed only on the first call to the function)
  ast?: Program
  isInSFC?: boolean
}

export interface ExtractResult {
  result: ExtractedTypes
  namesMap: Record<FullName, NameWithPath>
  typeReplacements: Record<NameWithPath, ExtractedTypeReplacement>
  extendsRecord: Record<NameWithPath, string[]>
  importNodes: ImportDeclaration[]
  extraSpecifiers: string[]
  sourceReplacements: Replacement[]
}

interface PreExtractionOptions {
  name: string
  metaData: ReferenceTypeMetaData
  replaceLocation: Omit<Replacement, 'replacement'>
}

interface PostExtractionOptions {
  key: NameWithPath
  name: string
  fullName: FullName
  metaData: LocalTypeMetaData
  isEnum?: boolean
}

/**
 * Given a specific source file, extract the specified types.
 */
export async function extractTypesFromSource(
  source: string,
  types: string[],
  options: ExtractTypesFromSourceOptions,
): Promise<ExtractResult> {
  const {
    relativePath,
    pathAliases,
    extractAliases = {},
    metaDataMap,

    extractedKeysCounter = {},
    extractedNamesMap = {},
    extractedTypes = new Map<NameWithPath, ExtractedTypeInfo>(),
    extractedTypeReplacements = {},
    interfaceExtendsRecord = {},
    extraSpecifiers = [],

    ast = getAst(source),
    isInSFC = false,
  } = options

  const debug = createAstDebugger('extractTypesFromSource')

  const missingTypes: Record<'local' | 'requested', string[]> = {
    local: [],
    requested: [],
  }

  const localMetaDataMap: Record<string, LocalTypeMetaData | undefined> = metaDataMap
  const replacementRecord: Record<string, ReplacementRecord[]> = {}

  debug('In SFC: %o', isInSFC)
  debug('Types to find: %o', types)
  debug('Local metadata map: %O', localMetaDataMap)
  debug('Extract aliases: %O', extractAliases)

  // Get external types
  const { imports, importNodes } = getAvailableImportsFromAst(ast)

  const { namedExports, namedFromExports, exportAllSources } = getAvailableExportsFromAst(ast)

  const hasExportAllDecl = !!exportAllSources.length

  debug('Relative path: %s', relativePath)
  debug('Counter: %O', extractedKeysCounter)

  // Categorize imports
  const groupedImportsResult = groupImports(imports, source, relativePath)

  const { localNodeMap, exportedNodeMap } = getTSNodeMap(extractAllTypescriptTypesFromAST(ast), namedExports)

  // local -> exported[]
  const exportAliasRecord: Record<string, string[]> = {}

  // exported -> local
  const exportAliases = namedExports.reduce<Record<string, string>>((res, e) => {
    if (e.local !== e.exported)
      res[e.exported] = e.local

    return res
  }, {})

  debug('Export aliases: %O', exportAliases)

  // local -> exported
  const reversedExportAliases = types.reduce<Record<string, string>>((res, maybeAlias) => {
    const localName = exportAliases[maybeAlias]

    if (!localName) {
      // Skip when it is exactly the local name
      return res
    }

    const alias = res[localName]

    // Add replacements to the existing's if we have already found an alias
    if (isString(alias)) {
      debug('Add replacements of %s to %s', maybeAlias, localName)

      const targetRecord = getSharedMetaData(localName)!.replacementTargets!

      const sourceRecord = getSharedMetaData(maybeAlias)!.replacementTargets!

      emptyMetaData(maybeAlias)

      targetRecord.push(...sourceRecord)
    }
    else {
      res[localName] = maybeAlias

      patchDataFromName(localName, maybeAlias)
    }

    exportAliasRecord[localName] ||= []
    exportAliasRecord[localName].push(maybeAlias)

    return res
  }, {})

  Object.entries(exportAliasRecord).forEach(([typeName, record]) => {
    // Add metadata if it has multiple aliases
    if (record.length > 1) {
      setMetaData(typeName, {
        hasDuplicateImports: true,
      })
    }
  })

  debug('Reversed export aliases: %O', reversedExportAliases)

  // Unwrap export aliases (exported -> local) to find types (and dedupe them)
  const processedTypes = [...new Set(types.map(name => exportAliases[name] || name))]

  debug('Processed types: %O', processedTypes)

  // SFC only variables (i.e. It will only be used in the first recursion)
  const sourceReplacements: Replacement[] = []

  const extractFromPosition = (start: MaybeNumber, end: MaybeNumber) =>
    isNumber(start) && isNumber(end) ? source.slice(start, end) : ''

  /**
   * Check if the given type name is included in the types that user (or previous recursion) requests to find
   */
  function isRequestedType(name: string) {
    return processedTypes.includes(name)
  }

  function withAlias(name: string): string {
    return extractAliases[name] || name
  }

  function withPath(name: string): NameWithPath {
    return `${relativePath}:${name}`
  }

  function unwrapPath(key: NameWithPath): string {
    return at(key.split(':'), -1)
  }

  function setNamesMap(fullName: FullName, nameWithPath: NameWithPath) {
    debug('Set names map: %s => %O', fullName, nameWithPath)
    extractedNamesMap[fullName] = nameWithPath
  }

  function getSharedMetaData(name: string): TypeMetaData | undefined {
    return localMetaDataMap[name]
  }

  function getMetaData(name: string): LocalTypeMetaData | undefined {
    return localMetaDataMap[name]
  }

  function getReplacementRecord(name: string): ReplacementRecord[] | undefined {
    return getSharedMetaData(name)!.replacementTargets
  }

  function setMetaData(name: string, val: LocalTypeMetaData): LocalTypeMetaData {
    const metaData = localMetaDataMap[name]

    if (metaData) {
      const mergedMetaData: LocalTypeMetaData = {
        ...metaData,
        ...val,
      }

      debug('Overriding metadata: %s => %O => %O', name, metaData, mergedMetaData)
      return localMetaDataMap[name] = mergedMetaData
    }
    else {
      debug('Set metadata: %s => %O', name, val)
      return localMetaDataMap[name] = val
    }
  }

  function emptyMetaData(name: string) {
    debug('Empty metadata %s', name)
    localMetaDataMap[name] = undefined
  }

  function patchDataFromName(name: string, from: string) {
    debug('Patching data for %s from %s', name, from)

    const sourceRecord = getSharedMetaData(name)?.replacementTargets

    const targetRecord = (setMetaData(name, getSharedMetaData(from)!) as TypeMetaData).replacementTargets!

    emptyMetaData(from)

    /**
     * If sourceRecord exists, it means that user also imported the original (local) name of the type
     * @example
     * ```typescript
     * import { Foo, Bar } from './foo'
     * ```
     * foo.ts
     * ```typescript
     * export { Foo, Foo as Bar }
     * ```
     */
    if (sourceRecord?.length) {
      targetRecord.push(...sourceRecord)

      exportAliasRecord[name] ||= []
      exportAliasRecord[name].push(name)
    }

    extractAliases[name] = extractAliases[from] || from
  }

  function getCount(name: string): number {
    return extractedKeysCounter[withAlias(name)] || 0
  }

  function addCount(name: string): number {
    const aliasedName = withAlias(name)
    debug('Add count: %s', aliasedName)
    return extractedKeysCounter[aliasedName] = 1 + getCount(aliasedName)
  }

  function getSuffix(name: string, offset = 0): string {
    const count = getCount(name) + 1 + offset

    return count > 1 ? `_${count}` : ''
  }

  function getFullName(name: string): string {
    const { isUsedType } = getMetaData(name) || {}

    const key = withPath(name)
    const { fullName } = extractedTypes.get(key) || {}

    // Return the fullName when the type is already extracted from current file
    if (fullName) {
      debug('Existing fullName: %s', fullName)
      return fullName
    }

    let prefix = Prefixes.Default
    const suffix = getSuffix(name)
    const node = localNodeMap.get(name)

    /**
     * NOTE(zorin): Do not prefix types used directly in vue macros or types declared in SFC (except enum types)
     */
    if (isUsedType || (isInSFC && node && !isEnum(node)))
      prefix = Prefixes.Empty

    const result = `${prefix}${withAlias(name)}${suffix}`

    debug('FullName: %s (%s)', result, name)

    return result
  }

  function convertFullNameToName(fullName: FullName): string {
    const fullNameRE = /(_VTI_TYPE_)?([\w\d$_]+)/g

    const matches = fullName.matchAll(fullNameRE)

    let result = ''

    for (const m of matches) {
      const arr = m[2].split('_')

      // Remove prefix if exists
      if (isNumber(parseInt(at(arr, -1))))
        arr.pop()

      result = arr.join('_')
    }

    return result
  }

  function addReplacementRecord(name: string, record: ReplacementRecord) {
    debug('Add replacement record: %s -> %O', name, record)

    replacementRecord[name] ||= []

    replacementRecord[name].push(record)
  }

  function addTypeReplacement(key: string, replacement: Replacement) {
    debug('Add type replacement: %s => %O', key, replacement)

    extractedTypeReplacements[key].replacements.push(replacement)
  }

  function addDependencyToType(key: string, dependency: string) {
    debug('Add dependency: %s => %s', key, dependency)

    const extractedTypeInfo = extractedTypes.get(key)!

    extractedTypeInfo.dependencies!.push(dependency)
  }

  // Change the name (the content of replacements) to the already extracted's
  function changeReplacementContent(replacementRecord: ReplacementRecord[], fullName: FullName) {
    const record: Record<string, string[]> = {}

    replacementRecord.forEach(({ target, source }) => {
      if (target === fullName || record[source]?.includes(target))
        return

      record[source] ||= []
      record[source].push(target)

      const sourceTypeInfo = extractedTypes.get(source)!

      const replacement = extractedTypeReplacements[source]

      replacement.replacements = replacement.replacements.map<Replacement>((r) => {
        if (r.replacement === target) {
          debug('Change name: %s -> %s', r.replacement, fullName)

          return {
            ...r,
            replacement: fullName,
          }
        }

        return r
      })

      sourceTypeInfo.dependencies = sourceTypeInfo.dependencies!.map(dep => dep === target ? fullName : dep)
    })
  }

  function removeTypeFromSource(node: Exclude<TSTypes, TSEnumDeclaration>) {
    debug('Remove type "%s" from source', node.id.name)

    sourceReplacements.push({
      start: node.start!,
      end: node.end!,
      replacement: '',
    })
  }

  function getTSNodeMap({ local, exported }: Record<'local' | 'exported', TSTypes[]>, namedExports: INamedExport[]): Record<'localNodeMap' | 'exportedNodeMap', NodeMap> {
    const localNodeMap = new Map<string, TSTypes>()
    const exportedNodeMap = new Map<string, TSTypes>()

    for (const node of local) {
      if (isString(node.id.name))
        localNodeMap.set(node.id.name, node)
    }

    for (const node of exported) {
      if (isString(node.id.name))
        exportedNodeMap.set(node.id.name, node)
    }

    for (const e of namedExports) {
      const node = localNodeMap.get(e.local)

      if (node && isString(node.id.name))
        exportedNodeMap.set(node.id.name, node)
    }

    return {
      localNodeMap,
      exportedNodeMap,
    }
  }

  function ExtractTypeByNode(node: TSTypes, fullName: string) {
    switch (node.type) {
      // Types e.g. export Type Color = 'red' | 'blue'
      case 'TSTypeAliasDeclaration': {
        extractTypesFromTypeAlias(node, fullName)
        break
      }
      // Interfaces e.g. export interface MyInterface {}
      case 'TSInterfaceDeclaration': {
        extractTypesFromInterface(node, fullName)
        break
      }
      // Enums e.g. export enum UserType {}
      case 'TSEnumDeclaration': {
        extractTypesFromEnum(node, fullName)
        break
      }
    }
  }

  /**
   * Extract ts types by name.
   */
  function extractTypeByName(_name: string) {
    const name = _name

    const replacementRecord = getReplacementRecord(name)

    const key = withPath(name)

    // Skip types that are already extracted from current file
    if (extractedTypes.has(key)) {
      debug('Skipping type: %s', name)

      if (replacementRecord?.length) {
        const { fullName } = extractedTypes.get(key)!

        changeReplacementContent(replacementRecord, fullName)
      }

      return
    }

    const node = isRequestedType(name) && !isInSFC ? exportedNodeMap.get(name) : localNodeMap.get(name)

    if (node) {
      const fullName = getFullName(name)

      /**
       * NOTE(zorin): Remove types from source if we are extracting types in SFC (except enum types),
       * because we need to make sure the order is correct
       */
      if (isInSFC && !isEnum(node))
        removeTypeFromSource(node)

      ExtractTypeByNode(node, fullName)
    }
    else {
      const exportedName = reversedExportAliases[_name]
      const name = exportedName || _name

      if (isString(exportedName))
        setMetaData(exportedName, getMetaData(_name)!)

      if (isInSFC)
        extraSpecifiers.push(name)

      debug('Missing type: %s', name)

      if (isRequestedType(_name) && !isInSFC)
        missingTypes.requested.push(name)
      else
        missingTypes.local.push(name)
    }
  }

  // Recursively calls this function to find types from other modules.
  const extractTypesFromModule = async (modulePath: string, types: string[], extractAliases: Record<string, string>, metaDataMap: Record<string, TypeMetaData>) => {
    const path = await resolveModulePath(modulePath, relativePath, pathAliases)

    if (!path)
      return

    /**
     * NOTE(zorin): Slow when use fsPromises.readFile(), tested on Arch Linux x64 (Kernel 5.16.11)
     * Wondering what make it slow. Temporarily, use fs.readFileSync() instead.
     */
    const contents = fs.readFileSync(path, 'utf-8')

    await extractTypesFromSource(contents, types, {
      relativePath: path,
      pathAliases,
      extractAliases,
      extractedTypes,
      extractedKeysCounter,
      extractedNamesMap,
      extractedTypeReplacements,
      interfaceExtendsRecord,
      metaDataMap,
      extraSpecifiers,
    })
  }

  function preReferenceExtraction(options: PreExtractionOptions): void {
    const { name, replaceLocation, metaData } = options

    const { referenceSource } = metaData

    const fullName = getFullName(name)

    addTypeReplacement(referenceSource, {
      start: replaceLocation.start,
      end: replaceLocation.end,
      replacement: fullName,
    })

    addReplacementRecord(name, {
      target: fullName,
      source: referenceSource,
    })

    addDependencyToType(referenceSource, fullName)

    setMetaData(name, metaData)
  }

  function postExtraction(options: PostExtractionOptions): void {
    const { key, name, fullName, isEnum, metaData: { isUsedType, hasDuplicateImports } } = options

    setNamesMap(fullName, key)

    /**
     * NOTE(zorin):Always add count for enum types
     * There are 2 reasons:
     * 1. I don't think users will use enum types in vue macros
     * 2. Whether they are declared in SFC or not, their names will always be prefixed (Because users may use them as values)
     *
     * Also, we don't need to add count for types used directly in vue macros or types declared in SFC
     * because they are not prefixed
     */
    if (isEnum || !(isUsedType || isInSFC))
      addCount(name)

    if (hasDuplicateImports)
      changeReplacementContent(getReplacementRecord(name)!, fullName)
  }

  const extractTypesFromTSUnionType = (union: TSUnionType, metaData: ReferenceTypeMetaData) => {
    const referenceSourceName = unwrapPath(metaData.referenceSource)

    union.types
      .filter((n): n is TSTypeReference => n.type === 'TSTypeReference')
      .forEach((typeReference) => {
        if (typeReference.typeName.type === 'Identifier' && typeReference.typeName.name !== referenceSourceName) {
          const name = typeReference.typeName.name

          preReferenceExtraction({
            name,
            replaceLocation: {
              start: typeReference.start!,
              end: typeReference.end!,
            },
            metaData: { ...metaData },
          })

          extractTypeByName(name)
        }
      })
  }

  function extractExtendInterfaces(interfaces: TSExpressionWithTypeArguments[], metaData: LocalTypeMetaData) {
    for (const extend of interfaces) {
      if (extend.expression.type === 'Identifier') {
        const name = extend.expression.name
        setMetaData(name, metaData)

        /**
         * TODO(zorin): (Low priority) Add dependency to the source type.
         * Currently, If the type is only extended (no additional references), it will not be inlined.
         */

        extractTypeByName(name)
      }
    }
  }

  /**
   * Extract ts type interfaces. Should also check top-level properties
   * in the interface to look for types to extract
   */
  const extractTypesFromInterface = (node: TSInterfaceDeclaration, fullName: string) => {
    const interfaceName = node.id.name
    const key = withPath(interfaceName)

    const { extendTarget, isUsedType, hasDuplicateImports } = getMetaData(interfaceName) || {}

    const bodyStart = node.body.start!
    const bodyEnd = node.body.end!
    const offset = -bodyStart

    const extendsInterfaces = node.extends

    extractedTypes.set(key, {
      typeKeyword: 'interface',
      fullName,
      body: extractFromPosition(bodyStart, bodyEnd),
      dependencies: [],
    })

    postExtraction({
      key,
      fullName,
      name: interfaceName,
      metaData: {
        isUsedType,
        hasDuplicateImports,
      },
    })

    if (extendTarget)
      interfaceExtendsRecord[extendTarget].push(key)

    if (extendsInterfaces) {
      interfaceExtendsRecord[key] = []

      extractExtendInterfaces(extendsInterfaces, {
        extendTarget: key,
      })
    }

    const propertyBody = node.body.body

    if (propertyBody.length) {
      extractedTypeReplacements[key] = {
        offset,
        replacements: [],
      }
    }

    for (const prop of propertyBody) {
      if (prop.type === 'TSPropertySignature') {
        const typeAnnotation = prop.typeAnnotation?.typeAnnotation

        if (typeAnnotation?.type === 'TSUnionType') {
          extractTypesFromTSUnionType(typeAnnotation, {
            referenceSource: key,
          })
        }
        else if (
          typeAnnotation?.type === 'TSTypeReference'
          && typeAnnotation.typeName.type === 'Identifier'
          && typeAnnotation.typeName.name !== interfaceName
        ) {
          const name = typeAnnotation.typeName.name

          preReferenceExtraction({
            name,
            replaceLocation: {
              start: typeAnnotation.start!,
              end: typeAnnotation.end!,
            },
            metaData: {
              referenceSource: key,
            },
          })

          extractTypeByName(name)
        }
      }
    }
  }

  /**
   * Extract types from TSTypeAlias
   */
  const extractTypesFromTypeAlias = (node: TSTypeAliasDeclaration, fullName: string) => {
    const typeAliasName = node.id.name
    const key = withPath(typeAliasName)
    const typeAnnotation = node.typeAnnotation

    const { isUsedType, hasDuplicateImports } = getMetaData(typeAliasName) || {}

    extractedTypes.set(key, {
      typeKeyword: 'type',
      fullName,
      body: extractFromPosition(typeAnnotation.start!, typeAnnotation.end!),
      dependencies: [],
    })

    postExtraction({
      key,
      fullName,
      name: typeAliasName,
      metaData: {
        isUsedType,
        hasDuplicateImports,
      },
    })

    extractedTypeReplacements[key] = {
      offset: -typeAnnotation.start!,
      replacements: [],
    }

    if (typeAnnotation.type === 'TSUnionType') {
      extractTypesFromTSUnionType(typeAnnotation, { referenceSource: key })
    }
    // TODO(zorin): Support TSLiteral, IntersectionType
    else if (typeAnnotation.type === 'TSTypeReference' && typeAnnotation.typeName.type === 'Identifier') {
      const name = typeAnnotation.typeName.name

      preReferenceExtraction({
        name,
        replaceLocation: {
          start: typeAnnotation.typeName.start!,
          end: typeAnnotation.typeName.end!,
        },
        metaData: {
          referenceSource: key,
        },
      })

      extractTypeByName(name)
    }
  }

  /**
   * NOTE(zorin): Convert enum types to union types, since Vue can't handle them right now
   *
   * NOTE(wheat): Since I don't believe these can depend on any other
   * types we just want to extract the string itself.
   */
  const extractTypesFromEnum = (node: TSEnumDeclaration, fullName: string) => {
    const enumName = node.id.name
    const key = withPath(enumName)
    const enumTypes: Set<string> = new Set()

    const { hasDuplicateImports, referenceSource } = (getMetaData(enumName) || {}) as ReferenceTypeMetaData

    const referenceSourceFile = at(referenceSource.split(':'), -2)

    // Remove extra specifier if it is referenced from SFC
    if (/\.vue$/.test(referenceSourceFile)) {
      const name = convertFullNameToName(fullName)

      if (name) {
        extraSpecifiers.forEach((specifier, idx) => {
          if (specifier === name)
            extraSpecifiers.splice(idx, 1)
        })
      }
    }

    // (semi-stable) Determine the type of enum, may not be able to process the use of complex scenes
    for (const member of node.members) {
      if (member.initializer) {
        if (member.initializer.type === 'NumericLiteral')
          enumTypes.add('number')
        else if (member.initializer.type === 'StringLiteral')
          enumTypes.add('string')
      }
      else {
        enumTypes.add('number')
      }
    }

    const result = [...enumTypes].join(' | ')

    let body = '/* enum */ '

    if (result)
      body += result
    else
      body = '/* empty-enum */ number | string'

    extractedTypes.set(key, {
      typeKeyword: 'type',
      fullName,
      body,
    })

    postExtraction({
      key,
      fullName,
      name: enumName,
      metaData: {
        hasDuplicateImports,
      },
      isEnum: true,
    })
  }

  /**
   * TODO(zorin): Remove corresponding replacements and dependencies if we could not find the type
   */
  async function findMissingTypesFromImport(modulePath: string, missingTypes: string[], aliases: Record<string, string> = {}) {
    debug('Find missing types %O from \'%s\'', missingTypes, modulePath)
    // imported -> local[]
    const importAliasRecord: Record<string, string[]> = {}

    // Generate new extract aliases (originalName -> userAlias) to replace the name of types
    const newExtractAliases = missingTypes.reduce<Record<string, string>>((res, maybeAlias) => {
      const originalName = aliases[maybeAlias]

      if (!originalName) {
        /**
          * NOTE(zorin): Apply alias for `import { default } from 'foo'`
          * In theory, this kind of syntax is only produced by the plugin (Users will get errors from TS if they write this kind of code)
          * The plugin converts `export { default } from 'foo'` to `import { default } from 'foo';export { default }`
          */
        if (maybeAlias === 'default') {
          const alias = extractAliases.default
          res.default = alias
          setMetaData(alias, getMetaData('default')!)
        }

        // Skip when it is exactly the imported name
        return res
      }

      const alias = res[originalName]

      // Add replacements to the existing's if we have already found an alias
      if (isString(alias)) {
        debug('Add replacements of %s to %s', maybeAlias, alias)

        const targetRecord = replacementRecord[alias] || getSharedMetaData(alias)!.replacementTargets!

        const sourceRecord = replacementRecord[maybeAlias] || getSharedMetaData(maybeAlias)!.replacementTargets!

        targetRecord.push(...sourceRecord)
      }
      else {
        res[originalName] = maybeAlias
      }

      importAliasRecord[originalName] ||= []
      importAliasRecord[originalName].push(maybeAlias)

      return res
    }, {})

    Object.entries(importAliasRecord).forEach(([typeName, record]) => {
      // Add metadata if it has multiple aliases
      if (record.length > 1) {
        const alias = newExtractAliases[typeName]

        setMetaData(alias, {
          hasDuplicateImports: true,
        })
      }
    })

    debug('New extract aliases: %O', newExtractAliases)

    // Apply aliases and record the number of times each type appears (also we dedupe them in this step)
    const typeCounter = missingTypes.reduce<Record<string, number>>((counter, _name) => {
      const name = aliases[_name] || _name

      counter[name] ??= 0

      counter[name] += 1

      return counter
    }, {})

    // Unwrap aliases (userAlias -> originalName) to find types
    const processedMissingTypes = Object.entries(typeCounter).map(([typeName, count]) => {
      /**
        * If the type has duplicate imports and its number does not match the number of its aliases,
        * it means that the user also imported the original(exported) name of the type
        * @example
        * ```typescript
        * import { Foo, Foo as Bar } from 'foo'
        * ```
        */
      if (count > 1 && count !== importAliasRecord[typeName].length) {
        const alias = newExtractAliases[typeName]

        debug('Push replacements of %s to %s (Original)', typeName, alias)

        const targetRecord = replacementRecord[alias] || getSharedMetaData(alias)!.replacementTargets!

        const sourceRecord = replacementRecord[typeName] || getSharedMetaData(typeName)!.replacementTargets!

        targetRecord.push(...sourceRecord)

        setMetaData(alias, {
          hasDuplicateImports: true,
        })
      }

      return typeName
    })

    debug('Processed missing types: %O', processedMissingTypes)

    // Generate aliases that apply the existing extract aliases for new extract aliases if exists
    const processedNewExtractAliases = Object.fromEntries(Object.entries(newExtractAliases).map(([originalName, userAlias]) => [originalName, extractAliases[userAlias] || userAlias]))

    debug('Processed new extract aliases: %O', processedNewExtractAliases)

    // Generate new metadata map from the missing types
    const newMetaDataMap = processedMissingTypes.reduce<Record<string, TypeMetaData>>((res, typeName) => {
      // Apply new extract alias if exists
      const name = newExtractAliases[typeName] || typeName
      const metaData = getMetaData(name)

      if (metaData) {
        (metaData as TypeMetaData).replacementTargets ||= replacementRecord[name]

        res[typeName] = metaData
      }

      return res
    }, {})

    await extractTypesFromModule(modulePath, processedMissingTypes, processedNewExtractAliases, newMetaDataMap)
  }

  async function findMissingTypes(missingTypes: string[], groupImportsResult: GroupedImportsResult): Promise<string[]> {
    const unresolved: string[] = []

    const { groupedImports, localSpecifierMap } = groupImportsResult

    debug('Grouped imports: %O', groupedImports)
    debug('Local specifier map: %O', localSpecifierMap)

    const resolvedImports = missingTypes.reduce<Record<string, string[]>>((res, typeName) => {
      const modulePath = localSpecifierMap[typeName]

      if (isString(modulePath)) {
        res[modulePath] ||= []
        res[modulePath].push(typeName)
      }
      else {
        if (!hasExportAllDecl)
          debug('Cannot find type: %s', typeName)

        unresolved.push(typeName)
      }

      return res
    }, {})

    for (const [modulePath, types] of Object.entries(resolvedImports))
      await findMissingTypesFromImport(modulePath, [...new Set(types)], groupedImports[modulePath])

    return unresolved
  }

  for (const typeName of processedTypes)
    extractTypeByName(typeName)

  debug('Local metadata map (after): %O', localMetaDataMap)
  debug('Replacement record: %O', replacementRecord)

  const unresolvedTypes: string[] = []

  if (missingTypes.local.length) {
    debug('Find missing types (Local)')

    const unresolved = await findMissingTypes(missingTypes.local, groupedImportsResult)

    unresolvedTypes.push(...unresolved)
  }

  if (missingTypes.requested.length) {
    debug('Find missing types (Requested)')

    /**
     * NOTE(zorin): For development convenience, we currently convert the export syntaxes to import syntaxes.
     * This behavior may be changed in the future
     */
    const groupedExportsResult = groupImports(convertExportsToImports([...namedExports, ...namedFromExports], groupedImportsResult), source, relativePath)

    const unresolved = await findMissingTypes(missingTypes.requested, groupedExportsResult)

    unresolvedTypes.push(...unresolved)
  }

  if (!isInSFC && unresolvedTypes.length && hasExportAllDecl) {
    debug('Find missing types (Export all)')

    for (const exportSource of exportAllSources)
      await findMissingTypesFromImport(exportSource, unresolvedTypes)
  }

  return {
    result: extractedTypes,
    namesMap: extractedNamesMap,
    typeReplacements: extractedTypeReplacements,
    extendsRecord: interfaceExtendsRecord,
    importNodes,
    extraSpecifiers,
    sourceReplacements,
  }
}
