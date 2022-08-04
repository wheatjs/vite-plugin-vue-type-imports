import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodeGetter, defineTransformTest } from "./_utils";

const codeGetter: CodeGetter = async ({ entry }) => readFile(resolve(__dirname, entry), 'utf-8');

const structureRE = /.+\/dynamic\/(.+)\/(.+)\//g

await defineTransformTest({
    category: 'Dynamic',
    filePattern: ['./fixtures/dynamic/**/*.vue'],
    fileName: __filename,
    codeGetter,
    structureRE
})
