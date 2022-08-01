import { parse } from '@vue/compiler-sfc';
import { Alias, AliasOptions } from 'vite';
import { extractTypesFromSource, getUsedInterfacesFromAst } from './ast';
import { getAst, MaybeAliases, replaceAtIndexes } from './utils';

export interface CleanOptions {
  newline?: boolean;
  interface?: boolean;
}

export interface TransformOptions {
  id: string;
  clean: CleanOptions;
  aliases?: MaybeAliases;
}

export async function transform(code: string, { id, aliases, clean }: TransformOptions) {
  const {
    descriptor: { scriptSetup },
  } = parse(code);

  if (scriptSetup?.lang !== 'ts' || !scriptSetup.content) return code;

  const program = getAst(scriptSetup.content);

  const interfaces = getUsedInterfacesFromAst(program);

  const { result, importNodes, extraSpecifiers, extraReplacements } = await extractTypesFromSource(
    scriptSetup.content,
    interfaces,
    {
      aliases,
      relativePath: id,
      ast: program,
      isInternal: true,
      cleanInterface: clean.interface,
    },
  );

  // Skip
  if (!result.size) {
    return code;
  }

  const resolvedTypes = [...result].reverse();
  const replacements = extraReplacements;

  // Clean up imports
  importNodes.forEach((i) => {
    const firstStart = i.specifiers[0].start!;
    const lastEnd = i.specifiers[i.specifiers.length - 1].end!;

    const savedSpecifiers = i.specifiers
      .map((specifier) => {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
          const name = specifier.imported.name;
          const shouldSave = !resolvedTypes.some((x) => x[0] === name);

          if (shouldSave && !extraSpecifiers.includes(name)) {
            return name;
          }

          return null;
        }

        return null;
      })
      .filter((s): s is string => s !== null);

    // Clean the whole import statement if no specifiers are saved.
    if (!savedSpecifiers.length) {
      replacements.push({
        start: i.start!,
        end: i.end!,
        replacement: '',
      });
    } else {
      replacements.push({
        start: firstStart,
        end: lastEnd,
        replacement: savedSpecifiers.join(', '),
      });
    }
  });

  const inlinedTypes = resolvedTypes.map((x) => x[1]).join('\n');

  const transformedCode = [
    // Tag head
    code.slice(0, scriptSetup.loc.start.offset),
    // Script setup content
    inlinedTypes,
    // Replace import statements
    replaceAtIndexes(scriptSetup.content, replacements, clean.newline),
    // Tag end
    code.slice(scriptSetup.loc.end.offset),
  ].join('\n');

  return transformedCode;
}
