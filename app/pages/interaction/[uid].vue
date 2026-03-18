<script setup lang="ts">
const route = useRoute()
const uid = route.params.uid as string

const { data, error } = await useFetch(`/api/interaction/${uid}`)
</script>

<template>
  <div class="interaction-page">
    <div class="card">
      <template v-if="error">
        <h2>Session Expired</h2>
        <p>This login session is no longer valid. Please try again from your application.</p>
      </template>

      <template v-else-if="data">
        <h2>Sign In</h2>
        <p v-if="data.params?.client_id" class="client-info">
          <strong>{{ data.params.client_id }}</strong> is requesting access
        </p>

        <SiweLogin
          :uid="uid"
          :client-id="data.params?.client_id"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.interaction-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
  font-family: Inter, system-ui, sans-serif;
}

.card {
  max-width: 420px;
  width: 100%;
  padding: 2rem;
  border-radius: 1rem;
  background: var(--surface, #fff);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

h2 {
  margin: 0 0 0.5rem;
  text-align: center;
}

.client-info {
  text-align: center;
  color: var(--text-secondary, #666);
  margin-bottom: 1.5rem;
}
</style>
