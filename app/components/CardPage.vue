<template>
  <div class="card-page">
    <Card>
      <h1 v-if="title">{{ title }}</h1>

      <section>
        <slot />
      </section>

      <footer v-if="$slots.footer">
        <slot name="footer" />
      </footer>
    </Card>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<style scoped>
.card-page {
  display: grid;
  place-items: center;
  min-block-size: 100dvh;
  padding: var(--spacer);

  > .card {
    max-inline-size: min(
      var(--dialog-width, 32rem),
      calc(100vw - var(--spacer) * 2)
    );
    inline-size: 100%;
    block-size: min-content;

    > h1 {
      font-family: var(--ui-font-family);
      font-size: var(--ui-font-size);
      text-transform: var(--ui-text-transform);
      margin: 0;
    }
  }
}
</style>
