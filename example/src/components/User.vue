<script setup lang="ts">
import { User } from '~/types'

defineProps<User>()
</script>

<template>
  <div>
    Name: {{ name }}
  </div>
</template>