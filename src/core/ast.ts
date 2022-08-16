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
import { generateCodeFrame } from '@vue/compiler-sfc'
import type {
  FullName,
  GroupedImports,
  LocationMap,
  MaybeAliases,
  MaybeNumber,
  NameWithPath,
  Replacement,
  TSTypes,
} from './utils'
import {
  convertExportsToImports,
  debuggerFactory,
  getAst,
  groupImports,
  intersect,
  isDefineEmits,
  isDefineProps,
  isEnum,
  isNumber,
  isString,
  isTSTypes,
  isWithDefaults,
  resolveModulePath,
  warn,
} from './utils'
import { LogMsg } from './constants'

enum Prefixes {
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
  }

  return {
    namedExports,
    namedFromExports,
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

export interface TypeMetaData {
  // The source type which reference this
  referenceSource?: string
  replacementIndex?: number
  dependencyIndex?: number
  // metadata for interfaces
  sourceInterfaceName?: string
  isProperty?: boolean
  // Whether it is used in vue macros
  isUsedType?: boolean
}

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

    ast = getAst(source),
    isInSFC = false,
  } = options

  const debug = createAstDebugger('extractTypesFromSource')

  debug('In SFC: %o', isInSFC)
  debug('Types to find: %o', types)
  debug('Metadata Map: %O', metaDataMap)
  debug('Extract aliases: %O', extractAliases)

  const missingTypes: Record<'local' | 'requested', string[]> = {
    local: [],
    requested: [],
  }

  // Get external types
  const { imports, importNodes } = getAvailableImportsFromAst(ast)

  const { namedExports, namedFromExports } = getAvailableExportsFromAst(ast)

  debug('Relative path: %s', relativePath)
  debug('Source: %s', source)
  debug('Counter: %O', extractedKeysCounter)

  // Categorize imports
  const groupedImports = groupImports(imports, source, relativePath)

  const { localNodeMap, exportedNodeMap } = getTSNodeMap(extractAllTypescriptTypesFromAST(ast), namedExports)

  let hasRedundantExportAliasWarning = false

  // localSpecifier -> locationInfo
  const exportedAliasLocationMap: LocationMap = {}

  const exportAliases = namedExports.reduce<Record<string, string>>((res, e) => {
    if (e.local !== e.exported) {
      res[e.exported] = e.local

      exportedAliasLocationMap[e.local] = {
        start: e.start,
        end: e.end,
      }

      patchDataFromName(e.local, e.exported)
    }

    return res
  }, {})

  debug('Export aliases: %O', exportAliases)

  const reversedExportAliases = Object.entries(exportAliases).reduce<Record<string, string>>((res, [exported, local]) => {
    const alias = res[local]

    if (isString(alias)) {
      const loc = exportedAliasLocationMap[local]

      hasRedundantExportAliasWarning = true

      warn(`ExportAlias "${exported}" is redundant because there is already an ExportAlias that exports the same type. ${LogMsg.UNEXPECTED_RESULT} ${LogMsg.SUGGEST_TYPE_ALIAS}`, {
        fileName: relativePath,
        codeFrame: generateCodeFrame(source, loc.start, loc.end),
      })
    }

    res[local] = exported

    return res
  }, {})

  debug('Reversed export aliases: %O', reversedExportAliases)

  // Apply export aliases (exported -> local) to find types (and dedupe them)
  const processedTypes = Object.keys(types.reduce<Record<string, string>>((res, _name) => {
    const name = exportAliases[_name] || _name
    const value = res[name]

    if (isString(value) && !hasRedundantExportAliasWarning) {
      const loc = exportedAliasLocationMap[_name]

      warn(`ExportSpecifier "${_name}" is redundant because there is already an ExportSpecifier that exports the same type. ${LogMsg.UNEXPECTED_RESULT} ${LogMsg.SUGGEST_TYPE_ALIAS}`, {
        fileName: relativePath,
        codeFrame: generateCodeFrame(source, loc.start, loc.end),
      })
    }

    res[name] = name

    return res
  }, {}))

  debug('Processed types: %O', processedTypes)

  // SFC only variables (i.e. It will only be used in the first recursion)
  const extraSpecifiers: string[] = []
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

  function withPath(name: string): string {
    return `${relativePath}:${name}`
  }

  function setNamesMap(fullName: FullName, nameWithPath: NameWithPath) {
    debug('Set names map: %s => %O', fullName, nameWithPath)
    extractedNamesMap[fullName] = nameWithPath
  }

  function getMetaData(name: string): TypeMetaData | undefined {
    return metaDataMap[name]
  }

  function setMetaData(name: string, val: TypeMetaData): void {
    const metaData = metaDataMap[name]

    if (metaData)
      debug('Override metadata: %s => %O => %O', name, metaData, val)
    else
      debug('Set metadata: %s => %O', name, val)

    metaDataMap[name] = val
  }

  function patchDataFromName(name: string, from: string) {
    debug('Patching data for %s from %s', name, from)
    setMetaData(name, getMetaData(from)!)

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

  function addTypeReplacement(key: string, replacement: Replacement): number {
    debug('Add type replacement: %s => %O', key, replacement)

    return extractedTypeReplacements[key].replacements.push(replacement) - 1
  }

  function addDependencyToType(key: string, dependency: string): number {
    debug('Add dependency: %s => %s', key, dependency)

    const extractedTypeInfo = extractedTypes.get(key)!

    return extractedTypeInfo.dependencies!.push(dependency) - 1
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

    const { referenceSource, replacementIndex, dependencyIndex } = metaDataMap[name] || {}

    const key = withPath(name)

    // Skip types that are already extracted from current file
    if (extractedTypes.has(key)) {
      debug('Skipping type: %s', name)

      // Change the name to the already extracted's
      if (referenceSource) {
        const { fullName } = extractedTypes.get(key)!

        const replacements = extractedTypeReplacements[referenceSource].replacements
        const dependencies = extractedTypes.get(referenceSource)!.dependencies!

        replacements[replacementIndex!].replacement = fullName
        dependencies[dependencyIndex!] = fullName
        debug('Change name: %s -> %s', name, fullName)
      }

      return
    }

    const node = isRequestedType(name) && !isInSFC ? exportedNodeMap.get(name) : localNodeMap.get(name)

    if (node) {
      const fullName = getFullName(name)

      if (isInSFC && !isEnum(node))
        removeTypeFromSource(node)

      ExtractTypeByNode(node, fullName)
    }
    else {
      const name = reversedExportAliases[_name] || _name

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
    })
  }

  const extractTypesFromTSUnionType = (union: TSUnionType, metaData: TypeMetaData) => {
    const { referenceSource } = metaData

    let replacementIndex: number | undefined
    let dependencyIndex: number | undefined

    union.types
      .filter((n): n is TSTypeReference => n.type === 'TSTypeReference')
      .forEach((typeReference) => {
        if (typeReference.typeName.type === 'Identifier') {
          const name = typeReference.typeName.name
          const referenceFullName = getFullName(name)

          if (referenceSource) {
            replacementIndex = addTypeReplacement(referenceSource!, {
              start: typeReference.start!,
              end: typeReference.end!,
              replacement: referenceFullName,
            })

            dependencyIndex = addDependencyToType(referenceSource!, referenceFullName)
          }

          setMetaData(name, {
            ...metaData,
            replacementIndex,
            dependencyIndex,
          })

          extractTypeByName(name)
        }
      })
  }

  function extractExtendInterfaces(interfaces: TSExpressionWithTypeArguments[], metaData: TypeMetaData) {
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

    const { sourceInterfaceName, isProperty, isUsedType } = getMetaData(interfaceName) || {}

    // Skip all process, since Vue only transform the type of nested objects to 'Object'
    if (isProperty) {
      extractedTypes.set(key, {
        typeKeyword: 'interface',
        fullName,
        body: '{}',
      })

      setNamesMap(fullName, key)

      addCount(interfaceName)
      return
    }

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

    setNamesMap(fullName, key)

    /**
     * NOTE(zorin): We don't need to add count for types used directly in vue macros or types declared in SFC
     * because they are not prefixed
     */
    if (!(isUsedType || isInSFC))
      addCount(interfaceName)

    if (sourceInterfaceName) {
      /**
       * NOTE(zorin): If the record does not exist, it means that the source interface comes from another file
       * So we need to initialize it
       */
      interfaceExtendsRecord[sourceInterfaceName] ||= []

      interfaceExtendsRecord[sourceInterfaceName].push(key)
    }

    if (extendsInterfaces) {
      interfaceExtendsRecord[key] = []

      extractExtendInterfaces(extendsInterfaces, {
        sourceInterfaceName: key,
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
            isProperty: true,
          })
        }
        else if (
          typeAnnotation?.type === 'TSTypeReference'
          && typeAnnotation.typeName.type === 'Identifier'
        ) {
          const name = typeAnnotation.typeName.name
          const referenceFullName = getFullName(name)

          const replacementIndex = addTypeReplacement(key, {
            start: typeAnnotation.start!,
            end: typeAnnotation.end!,
            replacement: referenceFullName,
          })

          const dependencyIndex = addDependencyToType(key, referenceFullName)

          setMetaData(name, {
            referenceSource: key,
            replacementIndex,
            dependencyIndex,
            isProperty: true,
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

    const { isUsedType } = metaDataMap[typeAliasName] || {}

    extractedTypes.set(key, {
      typeKeyword: 'type',
      fullName,
      body: extractFromPosition(typeAnnotation.start!, typeAnnotation.end!),
      dependencies: [],
    })

    setNamesMap(fullName, key)

    /**
     * NOTE(zorin): We don't need to add count for types used directly in vue macros or types declared in SFC
     * because they are not prefixed
     */
    if (!(isUsedType || isInSFC))
      addCount(typeAliasName)

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
      const referenceFullName = getFullName(name)

      const replacementIndex = addTypeReplacement(key, {
        start: typeAnnotation.typeName.start!,
        end: typeAnnotation.typeName.end!,
        replacement: referenceFullName,
      })

      const dependencyIndex = addDependencyToType(key, referenceFullName)

      setMetaData(name, {
        referenceSource: key,
        replacementIndex,
        dependencyIndex,
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

    extractedTypes.set(key, {
      typeKeyword: 'type',
      fullName,
      body: `${[...enumTypes].join(' | ') || 'number | string'};`,
    })

    setNamesMap(fullName, key)

    /**
     * NOTE(zorin): Always add count for enum types
     * There are 2 reasons:
     * 1. I don't think users will use enum types in vue macros
     * 2. Whether they are declared in SFC or not, their names will always be prefixed (Because users may use them as values)
     */
    addCount(enumName)
  }

  async function findMissingTypes(missingTypes: string[], groupedImports: GroupedImports) {
    debug('Missing types: %O', missingTypes)
    debug('Grouped imports: %O', groupedImports)

    for (const [modulePath, importInfo] of Object.entries(groupedImports)) {
      // Get intersection (it will dedupe the elements)
      const intersection = intersect(importInfo.localSpecifiers, missingTypes)

      debug('Intersection: %O', intersection)

      if (intersection.length) {
        const moduleImportAliases = importInfo.aliases
        const locationMap = importInfo.locationMap

        let hasRedundantAliasWarning = false

        // Generate new extract aliases (originalName -> userAlias) to replace the name of types
        const newExtractAliases = intersection.reduce<Record<string, string>>((res, maybeAlias) => {
          const originalName = moduleImportAliases[maybeAlias]

          if (!originalName) {
            /**
             * NOTE(zorin): Apply alias for `import { default as default } from 'foo'`
             * In theory, this kind of syntax is only produced by the plugin
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

          if (isString(alias)) {
            const loc = locationMap[maybeAlias]

            hasRedundantAliasWarning = true

            warn(`ImportAlias "${maybeAlias}" is redundant because there is already an ImportAlias that imports the same type. ${LogMsg.UNEXPECTED_RESULT} ${LogMsg.SUGGEST_TYPE_ALIAS}`, {
              fileName: relativePath,
              codeFrame: generateCodeFrame(source, loc.start, loc.end),
            })
          }

          res[originalName] = maybeAlias

          return res
        }, {})

        debug('New extract aliases: %O', newExtractAliases)

        // Apply aliases (userAlias -> originalName) to find types (and dedupe them)
        const processedIntersection = Object.keys(intersection.reduce<Record<string, string>>((res, _name) => {
          const name = moduleImportAliases[_name] || _name
          const value = res[name]

          if (isString(value) && !hasRedundantAliasWarning) {
            const loc = locationMap[_name]

            warn(`ImportSpecifier "${_name}" is redundant because there is already an ImportSpecifier that imports the same type. ${LogMsg.UNEXPECTED_RESULT} ${LogMsg.SUGGEST_TYPE_ALIAS}`, {
              fileName: relativePath,
              codeFrame: generateCodeFrame(source, loc.start, loc.end),
            })
          }

          res[name] = name

          return res
        }, {}))

        debug('Processed intersection: %O', processedIntersection)

        // Generate aliases that apply the existing extract aliases for new extract aliases if exists
        const processedNewExtractAliases = Object.fromEntries(Object.entries(newExtractAliases).map(([originalName, userAlias]) => [originalName, extractAliases[userAlias] || userAlias]))

        debug('Processed new extract aliases: %O', processedNewExtractAliases)

        // Generate new metadata map from the missing types
        const newMetaDataMap = processedIntersection.reduce<Record<string, TypeMetaData>>((res, typeName) => {
          // Apply new extract alias if exists
          const metaData = getMetaData(newExtractAliases[typeName] || typeName)

          if (metaData)
            res[typeName] = metaData

          return res
        }, {})

        await extractTypesFromModule(modulePath, processedIntersection, processedNewExtractAliases, newMetaDataMap)
      }
    }
  }

  for (const typeName of processedTypes)
    extractTypeByName(typeName)

  debug('MetaData Map After: %O', metaDataMap)

  if (missingTypes.local.length) {
    debug('Find missing types (Local)')

    await findMissingTypes(missingTypes.local, groupedImports)
  }

  if (missingTypes.requested.length) {
    debug('Find missing types (Requested)')

    const groupedExports = groupImports(convertExportsToImports([...namedExports, ...namedFromExports], groupedImports), source, relativePath)

    await findMissingTypes(missingTypes.requested, groupedExports)
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
