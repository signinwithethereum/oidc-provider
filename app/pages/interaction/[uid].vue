<script setup lang="ts">
const route = useRoute()
const uid = route.params.uid as string

const { data, error } = await useFetch(`/api/interaction/${uid}`, {
  headers: useRequestHeaders(['cookie']),
})

const title = computed(() =>
  !!error.value ? 'Session Expired' : !!data ? 'Sign In' : 'Unknown',
)
</script>

<template>
  <main>
    <Dialog
      :title="title"
      :open="!!error || !!data"
      :closable="false"
      :click-outside="false"
    >
      <template v-if="error">
        <p class="muted">
          This login session is no longer valid. Please try again from your
          application.
        </p>
        <p>{{ error.data?.message }}</p>
        <pre>{{ error.data }}</pre>
      </template>

      <template v-else-if="data?.params?.client_id">
        <p class="muted">
          <strong>{{ data.params.client_id }}</strong> is requesting access
        </p>

        <p>
          {{ uid }}

          {{ data.params.client_id }}
        </p>

        <EvmConnect />

        <!-- <SiweLogin -->
        <!--   :uid="uid" -->
        <!--   :client-id="data.params?.client_id" -->
        <!-- /> -->
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
main {
  max-width: 45rem;
  padding: var(--spacer);
  margin: auto;
}
/* .interaction-page { */
/*   display: flex; */
/*   align-items: center; */
/*   justify-content: center; */
/*   min-block-size: var(--100vh); */
/*   padding: var(--spacer); */
/* } */

/* h2 { */
/*   margin: 0 0 var(--spacer-sm); */
/*   text-align: center; */
/* } */
</style>
