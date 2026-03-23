<script setup lang="ts"></script>

<template>
  <div class="siwe-login">
    <Loading
      spinner
      stacked
      txt="Loading wallets"
    />
  </div>
</template>

<style scoped>
.siwe-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer);
  padding: var(--spacer);

  > * {
    inline-size: 100%;
  }
}
</style>
