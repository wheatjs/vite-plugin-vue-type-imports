import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CodeGetter } from './_utils'
import { defineTransformTest } from './_utils'

const codeGetter: CodeGetter = async ({ entry }) => readFile(resolve(__dirname, entry), 'utf-8')

const structureRE = /.+\/dynamic\/(.+)\/(.+)\//g

defineTransformTest({
  category: 'Dynamic',
  filePattern: ['./fixtures/dynamic/**/*.vue'],
  fileName: __filename,
  codeGetter,
  structureRE,
  realPath: true,
  skip: false,
})
