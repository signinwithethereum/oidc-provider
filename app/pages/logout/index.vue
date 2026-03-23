<script setup lang="ts">
const route = useRoute()

const xsrf = computed(() => String(route.query.xsrf || ''))
const action = computed(() => String(route.query.action || ''))
</script>

<template>
  <main>
    <Dialog
      :open="true"
      :closable="false"
      :click-outside="false"
      title="Sign Out"
      compat
    >
      <p class="muted">
        Do you want to sign out from this session?
      </p>

      <form :action="action" method="post" class="logout-actions">
        <input type="hidden" name="xsrf" :value="xsrf" />
        <Button type="submit" name="logout" value="yes" class="danger block">
          Yes, sign me out
        </Button>
        <Button type="submit" class="tertiary block">
          No, stay signed in
        </Button>
      </form>
    </Dialog>
  </main>
</template>

<style scoped>
.logout-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-sm);
  margin-block-start: var(--spacer);
}
</style>
