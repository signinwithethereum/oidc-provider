<script setup lang="ts">
const route = useRoute()
const uid = route.params.uid as string

const { data, error } = await useFetch(`/api/interaction/${uid}`)
</script>

<template>
  <div class="interaction-page">
    <Card>
      <template v-if="error">
        <h2>Session Expired</h2>
        <p>
          This login session is no longer valid. Please try again from your
          application.
        </p>
      </template>

      <template v-else-if="data">
        <h2>Sign In</h2>
        <p
          v-if="data.params?.client_id"
          class="client-info"
        >
          <strong>{{ data.params.client_id }}</strong> is requesting access
        </p>

        <SiweLogin
          :uid="uid"
          :client-id="data.params?.client_id"
        />
      </template>
    </Card>
  </div>
</template>

<style scoped>
.interaction-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--100vh);
  padding: var(--spacer);
}

h2 {
  margin: 0 0 var(--spacer-sm);
  text-align: center;
}

.client-info {
  text-align: center;
  color: var(--muted);
  margin-block-end: var(--spacer-md);
}
</style>
