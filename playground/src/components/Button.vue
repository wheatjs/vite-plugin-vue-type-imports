<script setup lang="ts">
import { ButtonProps } from '~/button-types'

defineProps<ButtonProps>()
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
