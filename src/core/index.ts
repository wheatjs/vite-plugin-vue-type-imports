import { parse } from '@vue/compiler-sfc'
import type { ExtractResult, TypeMetaData } from './ast'
import { extractTypesFromSource, getUsedInterfacesFromAst } from './ast'
import { debuggerFactory, getAst, notNullish, replaceAtIndexes, resolveDependencies, resolveExtends } from './utils'
import type { MaybeAliases, Replacement } from './utils'

export interface CleanOptions {
  interface?: boolean
}

export interface TransformOptions {
  id: string
  aliases?: MaybeAliases
}

export interface FinalizeResult {
  inlinedTypes: string
  replacements: Replacement[]
}

const createMainDebugger = debuggerFactory('Main')

export function finalize(types: string[], extractResult: ExtractResult): FinalizeResult | null {
  const debug = createMainDebugger('Finalize')

  const { result, namesMap, typeReplacements, extendsRecord, importNodes, extraSpecifiers, sourceReplacements } = extractResult

  if (!result.size)
    return null

  Object.entries(typeReplacements).forEach(([k, r]) => {
    debug('Replacements %s => %O', k, r)
  })

  debug('Keys map: %O', namesMap)

  // Apply replacements
  Object.entries(typeReplacements).forEach(([key, replacementInfo]) => {
    const extractedTypeInfo = result.get(key)!
    const { offset, replacements } = replacementInfo

    extractedTypeInfo.body = replaceAtIndexes(extractedTypeInfo.body, replacements, offset)
  })

  const resolvedExtendsOrder = resolveExtends(extendsRecord)

  debug('Resolved extends order: %O', resolvedExtendsOrder)

  // Insert code for extended interfaces in order
  resolvedExtendsOrder.forEach((key) => {
    const extractedTypeInfo = result.get(key)!

    const extendTypes = extendsRecord[key]

    if (!extendTypes?.length)
      return

    const replacements: Replacement[] = extendTypes.map((key) => {
      const { body, dependencies } = result.get(key)!

      // Add dependencies for extended interfaces
      if (dependencies?.length) {
        extractedTypeInfo.dependencies ||= []
        extractedTypeInfo.dependencies!.push(...dependencies)
      }

      return {
        start: 1,
        end: 1,
        replacement: body.slice(1, body.length - 1),
      }
    })

    extractedTypeInfo.body = replaceAtIndexes(extractedTypeInfo.body, replacements)
  })

  debug('Result: %O', result)

  // Collect replacements to clean up import specifiers
  importNodes.forEach((i) => {
    let defaultSpecifier: string | undefined

    const savedSpecifiers = i.specifiers
      .map((specifier) => {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && specifier.local.type === 'Identifier') {
          const imported = specifier.imported.name
          const local = specifier.local.name

          let fullName = local

          /**
           * NOTE(zorin): We only remove specifiers that used directly by user because the name of their dependencies are prefixed by the plugin
           */
          const shouldSave = !types.includes(local)

          if (shouldSave && !extraSpecifiers.includes(local)) {
            if (imported !== local)
              fullName = `${imported} as ${local}`

            return fullName
          }

          return null
        }
        else if (specifier.type === 'ImportDefaultSpecifier') {
          const name = specifier.local.name

          if (!types.includes(name) && !extraSpecifiers.includes(name))
            defaultSpecifier = name
        }

        return null
      })
      .filter(notNullish)

    const replacement: string[] = [
      'import',
    ]

    if (defaultSpecifier)
      replacement.push(` ${defaultSpecifier}`)

    if (savedSpecifiers.length)
      replacement.push(`${defaultSpecifier ? ',' : ''} { ${savedSpecifiers.join(', ')} }`)

    // Remove the import statement if no specifiers are saved
    if (replacement.length === 1) {
      sourceReplacements.push({
        start: i.start!,
        end: i.end!,
        replacement: '',
      })
    }
    // Generate a new import statement to replace the original one
    else {
      replacement.push(` from '${i.source.value}'`)

      sourceReplacements.push({
        start: i.start!,
        end: i.end!,
        replacement: replacement.join(''),
      })
    }
  })

  const dependencies = resolveDependencies(result, namesMap, types)

  debug('Dependencies: %O', dependencies)

  const inlinedTypes = dependencies.map((key) => {
    const { typeKeyword, fullName, body } = result.get(key)!

    let maybeEqualSign = ''

    if (typeKeyword === 'type')
      maybeEqualSign = ' ='

    return `${typeKeyword} ${fullName}${maybeEqualSign} ${body}`
  }).join('\n')

  return {
    inlinedTypes,
    replacements: sourceReplacements,
  }
}

export async function transform(code: string, { id, aliases }: TransformOptions) {
  const {
    descriptor: { scriptSetup },
  } = parse(code)

  if (scriptSetup?.lang !== 'ts' || !scriptSetup.content)
    return code

  const program = getAst(scriptSetup.content)

  const interfaces = getUsedInterfacesFromAst(program)

  const metaDataMap = Object.fromEntries(interfaces.map<[string, TypeMetaData]>(name => [name, { isUsedType: true }]))

  const extractResult = await extractTypesFromSource(
    scriptSetup.content,
    interfaces,
    {
      pathAliases: aliases,
      relativePath: id,
      metaDataMap,
      ast: program,
      isInSFC: true,
    },
  )

  const result = finalize(interfaces, extractResult)

  if (!result)
    return code

  const { inlinedTypes, replacements } = result

  const transformedCode = [
    code.slice(0, scriptSetup.loc.start.offset),
    // Types inlined by the plugin
    inlinedTypes,
    // Replace import statements
    replaceAtIndexes(scriptSetup.content, replacements),
    code.slice(scriptSetup.loc.end.offset),
  ].join('\n')

  return transformedCode
}
