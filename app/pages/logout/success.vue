<script setup lang="ts">
</script>

<template>
  <main>
    <Dialog
      :open="true"
      :closable="false"
      :click-outside="false"
      title="Signed Out"
      compat
    >
      <p class="muted">
        You have been successfully signed out.
      </p>

      <p class="muted hint">
        You may close this window.
      </p>
    </Dialog>
  </main>
</template>

<style scoped>
.hint {
  font-size: 0.85em;
  margin-block-start: var(--spacer);
}
</style>
