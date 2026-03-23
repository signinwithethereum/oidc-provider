<script setup lang="ts">
const route = useRoute()

const error = computed(() => String(route.query.error || 'server_error'))
const description = computed(
  () =>
    String(
      route.query.error_description || 'An unexpected error occurred',
    ),
)

const title = computed(() => {
  switch (error.value) {
    case 'invalid_client':
      return 'Unknown Application'
    case 'invalid_request':
      return 'Invalid Request'
    case 'invalid_grant':
      return 'Session Expired'
    case 'access_denied':
      return 'Access Denied'
    default:
      return 'Something Went Wrong'
  }
})
</script>

<template>
  <main>
    <CardPage :title="title">
      <p class="muted">
        {{ description }}
      </p>

      <p class="muted hint">
        Please close this window and try again from your application.
      </p>
    </CardPage>
  </main>
</template>

<style scoped>
.hint {
  font-size: 0.85em;
  margin-block-start: var(--spacer);
}
</style>
