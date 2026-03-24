<script setup lang="ts">
const props = defineProps<{
  uid: string
  nonce: string
  clientId?: string
  redirectUri?: string
}>()

const emit = defineEmits<{
  error: [message: string]
}>()

const { step, statusText, errorMessage, signIn, reset } = useSiwe()

const { address, isConnected } = useConnection()
const { mutate: disconnectAccount } = useDisconnect()

const isBusy = computed(() => ['reconnecting', 'signing', 'verifying', 'complete'].includes(step.value))
const userInitiated = ref(false)
const redirectTo = ref<string>()

function disconnect() {
  reset()
  disconnectAccount()
}

async function handleSignIn() {
  redirectTo.value = undefined

  const result = await signIn({
    getNonce: async () => props.nonce,
    statement: 'Sign-In with Ethereum',
    resources: props.redirectUri ? [props.redirectUri] : undefined,
    async verify(message: string, signature: string) {
      const response = await fetch(`/api/interaction/${props.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      })

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ statusMessage: 'Verification failed' }))
        throw new Error(error.statusMessage || 'Verification failed')
      }

      const data = await response.json()
      redirectTo.value = data.redirectTo
    },
  })

  if (!result) {
    emit('error', errorMessage.value)
    return
  }

  if (redirectTo.value) {
    await navigateTo(redirectTo.value, { external: true })
  }
}

// Auto-sign when user actively connects via EvmConnect
watch([isConnected, address], ([connected, addr]) => {
  if (connected && addr && step.value === 'idle' && userInitiated.value) {
    handleSignIn()
  }
})
</script>

<template>
  <div class="siwe-login">
    <Loading
      v-if="isBusy"
      spinner
      stacked
      :txt="step === 'complete' ? 'Redirecting…' : statusText"
    />

    <template v-else-if="isConnected && step === 'error'">
      <Alert type="error">
        <p>{{ errorMessage }}</p>
      </Alert>
      <Button
        class="danger block"
        @click="handleSignIn"
      >
        Try again
      </Button>
    </template>

    <template v-if="isConnected && address">
      <Button
        v-if="step === 'idle'"
        class="primary block"
        @click="handleSignIn"
      >
        Sign in with Ethereum
      </Button>
      <Button
        v-if="!isBusy"
        class="tertiary block"
        @click="disconnect()"
      >
        Switch wallet (<EvmAccount
          :address="address"
          class="siwe-address"
        />)
      </Button>
    </template>

    <EvmConnect
      v-else-if="!isBusy"
      @connecting="userInitiated = true"
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
