<script setup lang="ts">
import { Props } from '~/typings'

defineProps<Props>()
defineEmits<Props>()
</script>

<template>
  <button
    py-2
    px-4
    font-medium
    rounded
    m-8
  >
    <slot />
  </button>
</template>
