/* eslint-disable @typescript-eslint/no-use-before-define */
import fs from 'fs'
import type {
  CallExpression,
  ExportNamedDeclaration,
  ImportDeclaration,
  Node,
  Program,
  StringLiteral,
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
  MaybeAliases,
  Replacement,
  StringMap,
} from './utils'
import {
  getAst,
  groupImports,
  insertString,
  intersect,
  resolveModulePath,
} from './utils'

const DEFINE_PROPS = 'defineProps'
const DEFINE_EMITS = 'defineEmits'
const WITH_DEFAULTS = 'withDefaults'
const TS_TYPES_KEYS = ['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration']

const isDefineProps = (node: Node): node is CallExpression => isCallOf(node, DEFINE_PROPS)
const isDefineEmits = (node: Node): node is CallExpression => isCallOf(node, DEFINE_EMITS)
const isWithDefaults = (node: Node): node is CallExpression => isCallOf(node, WITH_DEFAULTS)

export interface IImport {
  start: number
  end: number
  local: string
  imported: string
  path: string
}

export interface InterfaceMetaData {
  extendInterfaceName?: string
  interfaceBodyStart?: number
  isProperty?: boolean
}

export type MaybeNumber = number | null | undefined

export type MaybeNode = Node | null | undefined

export type ExportNamedFromDeclaration = ExportNamedDeclaration & { source: StringLiteral }

export type TypeInfo = Partial<Record<'type' | 'name', string>>

export type GetTypesResult = (string | TypeInfo)[]

export interface GetImportsResult {
  imports: IImport[]
  importNodes: ImportDeclaration[]
}

export type TSTypes = TSTypeAliasDeclaration | TSInterfaceDeclaration | TSEnumDeclaration

export type NodeMap = Map<string, TSTypes>

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
    }

    importNodes.push(node)
  }

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && node.specifiers.length)
      addImport(node)
  }

  return { imports, importNodes }
}

/**
 * get reExported fields
 *
 * e.g. export { x } from './xxx'
 */
export function getAvailableExportsFromAst(ast: Program) {
  const exports: IImport[] = []

  // TODO: Support 'import { a as b }' syntax
  const addExport = (node: ExportNamedFromDeclaration) => {
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
        exports.push({
          start: specifier.exported.start!,
          end: specifier.local.end!,
          imported: specifier.exported.name,
          local: specifier.local.name,
          path: node.source.value,
        })
      }
    }
  }

  for (const node of ast.body) {
    // TODO: support export * from
    if (isExportNamedFromDeclaration(node))
      addExport(node)
  }

  return exports
}

export function getUsedInterfacesFromAst(ast: Program) {
  const interfaces: string[] = []

  const addInterface = (node: Node) => {
    if (node.type === 'CallExpression' && node.typeParameters?.type === 'TSTypeParameterInstantiation') {
      const propsTypeDefinition = node.typeParameters.params[0]

      if (propsTypeDefinition.type === 'TSTypeReference' && propsTypeDefinition.typeName.type === 'Identifier')
        interfaces.push(propsTypeDefinition.typeName.name)

      // TODO: Support nested type params
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
          // TODO: understand why we push a object
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

function extractAllTypescriptTypesFromAST(ast: Program, isInternal: boolean) {
  return ast.body
    .map((node) => {
      // e.g. 'export interface | type | enum'
      if (node.type === 'ExportNamedDeclaration' && node.declaration && isTSTypes(node.declaration, isInternal))
        return node.declaration

      // e.g. 'interface | type | enum'
      if (isTSTypes(node, isInternal))
        return node

      return null
    })
    .filter((x): x is TSTypes => x !== null)
}

type ExtractedTypes = StringMap
type MetaDataMap = Map<string, InterfaceMetaData>

interface ExtractTypesFromSourceOptions {
  relativePath: string
  aliases: MaybeAliases
  extractedTypes?: ExtractedTypes
  metaDataMap?: MetaDataMap
  // For internal interfaces
  ast?: Program
  isInternal?: boolean
  cleanInterface?: boolean
}

interface ExtractResult {
  result: StringMap
  importNodes: ImportDeclaration[]
  extraSpecifiers: string[]
  extraReplacements: Replacement[]
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
    aliases,
    ast = getAst(source),
    isInternal = false,
    cleanInterface = false,
    extractedTypes = new Map<string, string>(),
    metaDataMap = new Map<string, InterfaceMetaData>(),
  } = options

  // console.log(relativePath);

  const missingTypes: string[] = []

  // Get external types
  const { imports, importNodes } = getAvailableImportsFromAst(ast)

  if (!isInternal)
    imports.push(...getAvailableExportsFromAst(ast))

  // TODO: Fix duplicate key name
  const nodeMap = getTSNodeMap(extractAllTypescriptTypesFromAST(ast, isInternal))

  const extraSpecifiers: string[] = []
  const extraReplacements: Replacement[] = []

  const extractFromPosition = (start: MaybeNumber, end: MaybeNumber) =>
    isNumber(start) && isNumber(end) ? source.slice(start, end) : ''

  function removeInterface(node: TSInterfaceDeclaration) {
    extraReplacements.push({
      start: node.start!,
      end: node.end!,
      replacement: '',
    })
  }

  function getTSNodeMap(nodes: TSTypes[]): NodeMap {
    const nodeMap = new Map<string, TSTypes>()

    for (const node of nodes) {
      if ('name' in node.id)
        nodeMap.set(node.id.name, node)
    }

    return nodeMap
  }

  function ExtractTypeByNode(node: TSTypes) {
    switch (node.type) {
      // Types e.g. export Type Color = 'red' | 'blue'
      case 'TSTypeAliasDeclaration': {
        extractTypesFromTypeAlias(node)
        break
      }
      // Interfaces e.g. export interface MyInterface {}
      case 'TSInterfaceDeclaration': {
        extractTypesFromInterface(node)
        break
      }
      // Enums e.g. export enum UserType {}
      case 'TSEnumDeclaration': {
        extractTypesFromEnum(node)
        break
      }
    }
  }

  /**
   * Extract ts types by name.
   */
  function extractTypeByName(name: string) {
    // Skip already extracted types
    if (extractedTypes.get(name))
      return

    const node = nodeMap.get(name)

    if (node)
      ExtractTypeByNode(node)
    else
      missingTypes.push(name)
  }

  // Recursively calls this function to find types from other modules.
  const extractTypesFromModule = async (modulePath: string, types: string[]) => {
    const path = await resolveModulePath(modulePath, relativePath, aliases)

    if (!path)
      return

    // NOTE: Slow when use fsPromises.readFile(), tested on Arch Linux x64 (Kernel 5.16.11)
    // Wondering what make it slow. Temporarily, use fs.readFileSync() instead.
    const contents = fs.readFileSync(path, 'utf-8')

    await extractTypesFromSource(contents, types, {
      relativePath: path,
      aliases,
      extractedTypes,
      metaDataMap,
    })
  }

  const extractTypesFromTSUnionType = (union: TSUnionType) => {
    union.types
      .filter((n): n is TSTypeReference => n.type === 'TSTypeReference')
      .forEach((typeReference) => {
        if (typeReference.typeName.type === 'Identifier')
          extractTypeByName(typeReference.typeName.name)
      })
  }

  function extractExtendInterfaces(interfaces: TSExpressionWithTypeArguments[], interfaceMetaData: InterfaceMetaData) {
    for (const extend of interfaces) {
      if (extend.expression.type === 'Identifier') {
        const name = extend.expression.name
        metaDataMap.set(name, interfaceMetaData)

        if (isInternal)
          extraSpecifiers.push(name)

        extractTypeByName(name)
      }
    }
  }

  /**
   * Extract ts type interfaces. Should also check top-level properties
   * in the interface to look for types to extract
   */
  const extractTypesFromInterface = (node: TSInterfaceDeclaration) => {
    const { extendInterfaceName, interfaceBodyStart, isProperty } = metaDataMap.get(node.id.name) ?? {}

    const interfaceName = node.id.name
    const extendsInterfaces = node.extends

    // Skip all process, since Vue only transform the type of nested objects to 'Object'
    if (isProperty) {
      extractedTypes.set(interfaceName, `interface ${interfaceName} {}`)
      return
    }

    const bodyStart = node.body.start!
    const bodyEnd = node.body.end!

    if (extendInterfaceName) {
      extractedTypes.set(
        extendInterfaceName,
        insertString(
          extractedTypes.get(extendInterfaceName)!,
          interfaceBodyStart! + 1,
          extractFromPosition(bodyStart + 1, bodyEnd - 1),
        ),
      )

      if (isInternal && cleanInterface)
        removeInterface(node)

      if (extendsInterfaces) {
        extractExtendInterfaces(extendsInterfaces, {
          extendInterfaceName,
          interfaceBodyStart: interfaceBodyStart!,
        })
      }
    }
    else {
      extractedTypes.set(interfaceName, `interface ${interfaceName} ${extractFromPosition(bodyStart, bodyEnd)}`)

      if (extendsInterfaces) {
        if (isInternal)
          removeInterface(node)

        extractExtendInterfaces(extendsInterfaces, {
          extendInterfaceName: interfaceName,
          // 'interface A '.length -> 12
          interfaceBodyStart: interfaceName.length + 11,
        })
      }
      // No need to extract an individual interface
      else if (isInternal) {
        extractedTypes.delete(interfaceName)
      }
    }

    for (const prop of node.body.body) {
      if (prop.type === 'TSPropertySignature') {
        // TODO: Should this be filtered?
        if (prop.typeAnnotation?.typeAnnotation.type === 'TSUnionType') {
          extractTypesFromTSUnionType(prop.typeAnnotation.typeAnnotation)
        }
        else if (
          prop.typeAnnotation?.typeAnnotation.type === 'TSTypeReference'
          && prop.typeAnnotation.typeAnnotation.typeName.type === 'Identifier'
        ) {
          metaDataMap.set(prop.typeAnnotation.typeAnnotation.typeName.name, { isProperty: true })
          extractTypeByName(prop.typeAnnotation.typeAnnotation.typeName.name)
        }
      }
    }
  }

  /**
   * Extract types from TSTypeAlias
   */
  const extractTypesFromTypeAlias = (node: TSTypeAliasDeclaration) => {
    extractedTypes.set(node.id.name, extractFromPosition(node.start, node.end))

    if (node.typeAnnotation.type === 'TSUnionType')
      extractTypesFromTSUnionType(node.typeAnnotation)

    // TODO: Support TSLiteral, IntersectionType
    if (node.typeAnnotation.type === 'TSTypeReference' && node.typeAnnotation.typeName.type === 'Identifier')
      extractTypeByName(node.typeAnnotation.typeName.name)
  }

  /**
   * Extract enum types. Since I don't believe these can depend on any other
   * types we just want to extract the string itself.
   *
   * Zorin: Since Vue can't handle Enum types right now, would it be better to convert it to 'type [name] = number | string;'?
   */
  const extractTypesFromEnum = (node: TSEnumDeclaration) => {
    const enumName = node.id.name
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

    extractedTypes.set(enumName, `type ${enumName} = ${[...enumTypes].join(' | ') || 'number | string'};`)
  }

  for (const typeName of types)
    extractTypeByName(typeName)

  if (missingTypes.length) {
    await Promise.all(
      Object.entries(groupImports(imports)).map(async ([modulePath, importedFields]) => {
        const intersection = intersect(importedFields, missingTypes)

        if (intersection.length)
          await extractTypesFromModule(modulePath, intersection)
      }),
    )
  }

  return {
    result: extractedTypes,
    importNodes,
    extraSpecifiers,
    extraReplacements,
  }
}

export function isNumber(n: MaybeNumber): n is number {
  return typeof n === 'number'
}

export function isCallOf(node: MaybeNode, test: string | ((id: string) => boolean)): node is CallExpression {
  return !!(
    node
    && node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && (typeof test === 'string' ? node.callee.name === test : test(node.callee.name))
  )
}

export function isTSTypes(node: MaybeNode, isInternal: boolean): node is TSTypes {
  if (isInternal)
    return !!(node && node.type === 'TSInterfaceDeclaration')

  return !!(node && TS_TYPES_KEYS.includes(node.type))
}

export function isExportNamedFromDeclaration(node: MaybeNode): node is ExportNamedFromDeclaration {
  return !!(node && node.type === 'ExportNamedDeclaration' && node.source)
}
