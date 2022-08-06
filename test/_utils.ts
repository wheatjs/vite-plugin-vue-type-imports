import { basename, dirname } from 'path'
import fg from 'fast-glob'
import type { Awaitable } from 'vitest'
import type { TransformOptions } from '../src/core'
import { transform } from '../src/core'
import { generatePresets } from './_presets'

export function normalizeName(val: string): string {
  const result = val.replace(/-/g, ' ')
  return result[0].toUpperCase() + result.slice(1)
}

export interface TestMetaData {
  entry: string
  entryName: string
  presetName: string
  options: TransformOptions
}

export type DirectoryStructure = Record<string, Record<string, string[]>>

export function generateDirectoryStructure(files: string[], re?: RegExp): DirectoryStructure {
  const structureRE = re ?? /.+\/common\/(.+)\/(.+)\//g
  const result: DirectoryStructure = {}

  files.forEach((file) => {
    let scenario = ''
    let detailedScenario = ''

    const structureMatches = file.matchAll(structureRE)

    for (const m of structureMatches) {
      scenario = normalizeName(m[1])
      detailedScenario = normalizeName(m[2])
    }

    if (!(scenario || detailedScenario))
      throw new Error('Error while parsing directory structure.')

    result[scenario] ??= {}
    result[scenario][detailedScenario] ??= []
    result[scenario][detailedScenario].push(file)
  })

  return result
}

export type CodeGetter = (metaData: TestMetaData) => Awaitable<string>

export interface DefineTransformTestOptions {
  category: string
  codeGetter: CodeGetter
  filePattern: string | string[]
  fileName: string
  structureRE?: RegExp
}

export function defineTransformTest(options: DefineTransformTestOptions) {
  const { category, codeGetter, filePattern, fileName, structureRE } = options

  describe(category, async () => {
    // NOTE: Relative paths
    const files = await fg(filePattern, { cwd: dirname(fileName) })

    const directoryStructure = generateDirectoryStructure(files, structureRE)

    // Scenario
    describe.each(Object.keys(directoryStructure))('%s', (scenario) => {
      // Detailed scenario
      describe.each(Object.keys(directoryStructure[scenario]))('%s', (detailedScenario) => {
        const entries = directoryStructure[scenario][detailedScenario]

        const tests: TestMetaData[] = []

        entries.forEach((entry) => {
          Object.entries(generatePresets(fileName)).forEach(([presetName, options]) => {
            tests.push({
              entry,
              entryName: basename(entry),
              presetName,
              options,
            })
          })
        })

        // Entry files
        test.each(tests)('$entryName ($presetName)', async (metaData) => {
          const code = await codeGetter(metaData)
          // Mock fake file and fake path to transform
          const result = await transform(code, metaData.options)

          expect(result).toMatchSnapshot()
        })
      })
    })
  })
}
