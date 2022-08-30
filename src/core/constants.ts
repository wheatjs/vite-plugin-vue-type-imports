// Vue macros
export const DEFINE_PROPS = 'defineProps'
export const DEFINE_EMITS = 'defineEmits'
export const WITH_DEFAULTS = 'withDefaults'

export const PLUGIN_NAME = 'vite-plugin-vue-type-imports'

// Typescript types that the plugin allow to extract.
export const TS_TYPES_KEYS = ['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration']

// Messages that can be reused for logger
export enum LogMsg {
  SUGGEST_TYPE_ALIAS = 'If you want to use types with the same definition but different names, use type alias instead!',
  UNEXPECTED_RESULT = 'The results of the transformation will likely not meet your expectations.',
}
