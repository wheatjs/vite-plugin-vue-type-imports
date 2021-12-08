<script setup lang="ts">
import { ButtonProps, ButtonEmits } from '~/button-types'

defineProps<ButtonProps>()
defineEmits<ButtonEmits>()
</script>

<template>
  <button
    py-2
    px-4
    font-medium
    rounded
    m-8
    :style="{ background: color }"
  >
    <slot />
  </button>
</template>
