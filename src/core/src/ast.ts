import fs from 'node:fs/promises'
import {
  CallExpression,
  ImportDeclaration,
  Node,
  Program,
  TSTypeLiteral,
  TSTypeParameterInstantiation,
  TSTypeAliasDeclaration,
  TSNamespaceExportDeclaration,
  TSModuleDeclaration,
  TSInterfaceDeclaration,
  TSEnumDeclaration,
  TSTypeReference,
  TSUnionType,
  ExportNamedDeclaration,
} from '@babel/types'
import { babelParse } from '@vue/compiler-sfc'
import { AliasOptions, Alias } from 'vite'
import { groupImports, intersect, resolveModulePath } from './utils'

const DEFINE_PROPS = 'defineProps'
const DEFINE_EMITS = 'defineEmits'
const WITH_DEFAULTS = 'withDefaults'

const isDefineProps = (node: Node) => isCallOf(node, DEFINE_PROPS)
const isDefineEmits = (node: Node) => isCallOf(node, DEFINE_EMITS)
const isWithDefaults = (node: Node) => isCallOf(node, WITH_DEFAULTS)

export interface IImport {
  start: number
  end: number
  local: string
  imported: string
  path: string
}

export function getAvailableImportsFromAst(ast: Program) {
  const imports: IImport[] = []

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
  }

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration')
      addImport(node)
  }

  return imports
}

export function getAvailableExportsFromAst(ast: Program) {
  const exports: IImport[] = []

  const addExport = (node: ExportNamedDeclaration) => {
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
        exports.push({
          start: specifier.exported.start!,
          end: specifier.local.end!,
          imported: specifier.exported.name,
          local: specifier.local.name,
          path: node.source!.value,
        })
      }
    }
  }

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration')
      addExport(node)
  }

  return exports
}

export function getUsedInterfacesFromAst(ast: Program) {
  const interfaces: string[] = []

  const addInterface = (node: Node) => {
    if (node.type === 'CallExpression' && node.typeParameters?.type === 'TSTypeParameterInstantiation') {
      const propsTypeDefinition = node.typeParameters.params[0]

      if (propsTypeDefinition.type === 'TSTypeReference') {
        if (propsTypeDefinition.typeName.type === 'Identifier')
          interfaces.push(propsTypeDefinition.typeName.name)

        if (propsTypeDefinition.typeParameters)
          interfaces.push(...getTypesFromTypeParameters(propsTypeDefinition.typeParameters))
      }
    }
  }

  for (const node of ast.body) {
    if (node.type === 'ExpressionStatement') {
      if (isWithDefaults(node.expression))
        addInterface((node.expression as any).arguments[0])

      else if (isDefineProps(node.expression) || isDefineEmits(node.expression))
        addInterface(node.expression)
    }

    if (node.type === 'VariableDeclaration' && !node.declare) {
      for (const decl of node.declarations) {
        if (decl.init) {
          if (isWithDefaults(decl.init))
            addInterface((decl.init as any).arguments[0])

          else if (isDefineProps(decl.init) || isDefineEmits(decl.init))
            addInterface(decl.init)
        }
      }
    }
  }

  return interfaces
}

function getTypesFromTypeParameters(x: TSTypeParameterInstantiation) {
  const types: any[] = []

  for (const p of x.params) {
    if (p.type === 'TSTypeLiteral') {
      types.push(...getTSTypeLiteralTypes(p))
    }
    else if (p.type === 'TSTypeReference') {
      if (p.typeName.type === 'Identifier')
        types.push(p.typeName.name)
    }
  }

  return types
}

function getTSTypeLiteralTypes(x: TSTypeLiteral) {
  const types: any[] = []

  for (const m of x.members) {
    if (m.type === 'TSPropertySignature') {
      if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeLiteral') {
        types.push(...getTSTypeLiteralTypes(m.typeAnnotation.typeAnnotation))
      }
      else if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeReference') {
        if (m.typeAnnotation.typeAnnotation.typeName.type === 'Identifier') {
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

export async function extractTypeByName(source: string, ast: Program, name: string) {
  for (const node of ast.body) {
    if (node.type === 'TSInterfaceDeclaration' || node.type === 'TSEnumDeclaration' || node.type === 'TSTypeAliasDeclaration') {
      if (typeof node.start !== 'undefined' && node.end && node.id.name === name) {
        return {
          code: source.substring(node.start || 0, node.end),
        }
      }
    }
    else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.type === 'TSInterfaceDeclaration' || node.declaration.type === 'TSTypeAliasDeclaration' || node.declaration.type === 'TSEnumDeclaration') {
        if (typeof node.start !== 'undefined' && node.end && node.declaration.id.name === name) {
          return {
            code: source.substring(node.start || 0, node.end),
          }
        }
      }
    }
  }
}

function extractAllTypescriptTypesFromAST(ast: Program) {
  const TSTypes = ['TSTypeAliasDeclaration', 'TSNamespaceExportDeclaration', 'TSModuleDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration']

  return ast.body.map((node) => {
    if (node.type === 'ExportNamedDeclaration' && node.declaration && TSTypes.includes(node.declaration.type))
      return node.declaration

    if (TSTypes.includes(node.type))
      return node

    return null
  }).filter(x => x) as (TSTypeAliasDeclaration | TSNamespaceExportDeclaration | TSModuleDeclaration | TSInterfaceDeclaration | TSEnumDeclaration)[]
}

interface ExtractTypesFromSourceOptions {
  relativePath: string
  aliases: ((AliasOptions | undefined) & Alias[]) | undefined
}

/**
 * Given a specific source file, extract the specified types.
 */
export async function extractTypesFromSource(source: string, types: string[], options: ExtractTypesFromSourceOptions) {
  const extractedTypes: [string, string][] = []
  const missingTypes: string[] = []
  const ast = (await babelParse(source, { sourceType: 'module', plugins: ['typescript', 'topLevelAwait'] })).program
  const imports = [...getAvailableImportsFromAst(ast), ...getAvailableExportsFromAst(ast)]
  const typescriptNodes = extractAllTypescriptTypesFromAST(ast)

  const extractFromPosition = (start: number | null, end: number | null) => start && end ? source.substring(start, end) : ''

  // Recursively calls this function to find types from other modules.
  const extractTypesFromModule = async(modulePath: string, types: string[]) => {
    const path = await resolveModulePath(modulePath, options.relativePath, options.aliases)
    if (!path)
      return []

    const contents = await fs.readFile(path, 'utf-8')
    return extractTypesFromSource(contents, types, { relativePath: path, aliases: options.aliases })
  }

  const extractTypesFromTSUnionType = async(union: TSUnionType) => {
    union.types
      .filter((n): n is TSTypeReference => n.type === 'TSTypeReference')
      .forEach((typeReference) => {
        if (typeReference.typeName.type === 'Identifier') {
          // eslint-disable-next-line no-use-before-define
          extractTypeByName(typeReference.typeName.name)
        }
      })
  }

  /**
   * Extract M
   */
  const extractTypeByName = async(name: string) => {
    for (const node of typescriptNodes) {
      if ('name' in node.id && node.id.name === name) {
        if (node.type === 'TSTypeAliasDeclaration') {
          // eslint-disable-next-line no-use-before-define
          return extractTypesFromTypeAlias(node)
        }
        else if (node.type === 'TSInterfaceDeclaration') {
          // eslint-disable-next-line no-use-before-define
          return extractTypesFromInterface(node)
        }
        else if (node.type === 'TSEnumDeclaration') {
          // eslint-disable-next-line no-use-before-define
          return extractTypesFromEnum(node)
        }
      }
    }

    missingTypes.push(name)
  }

  /**
   * Extract ts type interfaces. Should also check top-level properties
   * in the interface to look for types to extract
   */
  const extractTypesFromInterface = (node: TSInterfaceDeclaration) => {
    extractedTypes.push([node.id.name, extractFromPosition(node.start, node.end)])

    if (node.extends) {
      for (const extend of node.extends) {
        if (extend.expression.type === 'Identifier')
          extractTypeByName(extend.expression.name)
      }
    }

    for (const prop of node.body.body) {
      if (prop.type === 'TSPropertySignature') {
        if (prop.typeAnnotation?.typeAnnotation.type === 'TSUnionType')
          extractTypesFromTSUnionType(prop.typeAnnotation.typeAnnotation)
        else if (prop.typeAnnotation?.typeAnnotation.type === 'TSTypeReference' && prop.typeAnnotation.typeAnnotation.typeName.type === 'Identifier')
          extractTypeByName(prop.typeAnnotation.typeAnnotation.typeName.name)
      }
    }
  }

  /**
   * Extract types from TSTypeAlias
   */
  const extractTypesFromTypeAlias = (node: TSTypeAliasDeclaration) => {
    extractedTypes.push([node.id.name, extractFromPosition(node.start, node.end)])

    if (node.typeAnnotation.type === 'TSUnionType')
      extractTypesFromTSUnionType(node.typeAnnotation)

    if (node.typeAnnotation.type === 'TSTypeReference' && node.typeAnnotation.typeName.type === 'Identifier')
      extractTypeByName(node.typeAnnotation.typeName.name)
  }

  /**
   * Extract enum types. Since I don't believe these can depend on any other
   * types we just want to extract the string itself.
   */
  const extractTypesFromEnum = (node: TSEnumDeclaration) => {
    extractedTypes.push([
      node.id.name,
      extractFromPosition(node.start, node.end),
    ])
  }

  for (const node of typescriptNodes) {
    for (const typeName of types) {
      // Interfaces e.g. export interface MyInterface {}
      if (node.type === 'TSInterfaceDeclaration' && node.id.name === typeName)
        extractTypesFromInterface(node)

      // Types e.g. export Type Color = 'red' | 'blue'
      else if (node.type === 'TSTypeAliasDeclaration' && node.id.name === typeName)
        extractTypesFromTypeAlias(node)

      // Enums e.g. export enum UserType {}
      else if (node.type === 'TSEnumDeclaration' && node.id.name === typeName)
        extractTypesFromEnum(node)

      else
        missingTypes.push(typeName)
    }
  }

  await Promise.all(Object.entries(groupImports(imports))
    .map(async([url, importedTypes]) => {
      const intersection = intersect(importedTypes, missingTypes)

      if (intersection.length > 0)
        extractedTypes.push(...(await extractTypesFromModule(url, intersection)))
    }))

  return extractedTypes
}

export function isCallOf(
  node: Node | null | undefined,
  test: string | ((id: string) => boolean),
): node is CallExpression {
  return !!(
    node
    && node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && (typeof test === 'string'
      ? node.callee.name === test
      : test(node.callee.name))
  )
}
