<script setup lang="ts">
const route = useRoute()
const uid = route.params.uid as string

const { data, error } = await useFetch(`/api/interaction/${uid}`, {
  headers: useRequestHeaders(['cookie']),
})
</script>

<template>
  <main>
    <Dialog
      :open="!!error || !!data"
      :closable="false"
      :click-outside="false"
      :title="error ? error.data?.message || 'Session Expired' : undefined"
      compat
    >
      <template v-if="error">
        <p class="muted">
          This login session is no longer valid. Please try again from your
          application.
        </p>
      </template>

      <template v-else-if="data?.params?.client_id">
        <div class="client-info">
          <img
            v-if="data.client?.logo_uri"
            :src="data.client.logo_uri"
            :alt="data.client.name || 'App logo'"
            class="client-logo"
          />
          <p class="muted">
            <a
              v-if="data.client?.client_uri"
              :href="data.client.client_uri"
              target="_blank"
              rel="noopener"
            >
              <strong>{{ data.client?.name || data.params.client_id }}</strong>
            </a>
            <strong v-else>{{
              data.client?.name || data.params.client_id
            }}</strong>
            is requesting access via Sign In With Ethereum
          </p>
        </div>

        <hr />

        <SiweLogin
          :uid="uid"
          :client-id="data.params?.client_id"
          :redirect-uri="data.params?.redirect_uri"
        />

        <footer
          v-if="data.client?.policy_uri || data.client?.tos_uri"
          class="legal-links"
        >
          <a
            v-if="data.client.policy_uri"
            :href="data.client.policy_uri"
            target="_blank"
            rel="noopener"
            >Privacy Policy</a
          >
          <span v-if="data.client.policy_uri && data.client.tos_uri">
            &middot;
          </span>
          <a
            v-if="data.client.tos_uri"
            :href="data.client.tos_uri"
            target="_blank"
            rel="noopener"
            >Terms of Service</a
          >
        </footer>
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
.client-info {
  text-align: center;
  padding: var(--spacer) var(--spacer) 0;
  padding: var(--spacer);
  display: flex;
  flex-direction: column;
  gap: var(--spacer);

  .client-logo {
    display: block;
    margin-inline: auto;
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 12px;
    margin-block-end: var(--spacer-sm);
  }

  p {
    text-wrap: balance;
  }

  + hr {
    width: 9rem;
    margin-inline: auto;
  }
}

.legal-links {
  margin-block-start: var(--spacer);
  text-align: center;
  font-size: 0.8em;
  opacity: 0.7;
}
</style>
