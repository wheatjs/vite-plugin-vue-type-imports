<script setup lang="ts">
import type { GlobalEmits } from '~/types'

defineEmits<GlobalEmits>()
</script>

<template>
  <button>
    <slot />
  </button>
</template>
