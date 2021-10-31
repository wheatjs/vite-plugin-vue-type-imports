import { CallExpression, ImportDeclaration, Node, Program, TSTypeLiteral, TSTypeParameterInstantiation } from '@babel/types'

const DEFINE_PROPS = 'defineProps'
const DEFINE_EMITS = 'defineEmits'
const WITH_DEFAULTS = 'withDefaults'

const isDefineProps = (node: Node) => isCallOf(node, DEFINE_PROPS)
const isDefineEmits = (node: Node) => isCallOf(node, DEFINE_EMITS)
const isWithDefaults = (node: Node) => isCallOf(node, WITH_DEFAULTS)

interface IImport {
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
      if (isWithDefaults(node.expression)) {
        addInterface((node.expression as any).arguments[0])
      } else if (isDefineProps(node.expression) || isDefineEmits(node.expression)) {
        addInterface(node.expression)
      }
    }

    if (node.type === 'VariableDeclaration' && !node.declare) {
      for (const decl of node.declarations) {
         if (decl.init) {
          if (isWithDefaults(decl.init)) {
            addInterface((decl.init as any).arguments[0])
          } else if (isDefineProps(decl.init) || isDefineEmits(decl.init)) {
            addInterface(decl.init)
          }
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
    } else if (p.type === 'TSTypeReference') {
      if (p.typeName.type === 'Identifier') {
        types.push(p.typeName.name)
      }
    }
  }

  return types
}

function getTSTypeLiteralTypes(x: TSTypeLiteral) {
  const types: any[] = []

  for (let m of x.members) {
    if (m.type === 'TSPropertySignature') {
      if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeLiteral') {
        types.push(...getTSTypeLiteralTypes(m.typeAnnotation.typeAnnotation))
      } else if (m.typeAnnotation?.typeAnnotation.type === 'TSTypeReference') {
        if (m.typeAnnotation.typeAnnotation.typeName.type === 'Identifier') {
          types.push({
            type: m.typeAnnotation.typeAnnotation.type,
            name: m.typeAnnotation.typeAnnotation.typeName.name
          })
        }

        if (m.typeAnnotation.typeAnnotation.typeParameters) {
          types.push(...getTypesFromTypeParameters(m.typeAnnotation.typeAnnotation.typeParameters))
        }
      } else {
        types.push({ type: m.typeAnnotation?.typeAnnotation.type })
      }
    }
  }

  return types
}

export function isCallOf(
  node: Node | null | undefined,
  test: string | ((id: string) => boolean)
): node is CallExpression {
  return !!(
    node &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    (typeof test === 'string'
      ? node.callee.name === test
      : test(node.callee.name))
  )
}
