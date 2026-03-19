<script setup lang="ts">
import { createSiweMessage } from '@1001-digital/components.evm'

const props = defineProps<{
  uid: string
  clientId?: string
}>()

const emit = defineEmits<{
  error: [message: string]
}>()

type Status = 'idle' | 'signing' | 'verifying' | 'error'

const status = ref<Status>('idle')
const errorMessage = ref('')

const { address, chainId, isConnected, connector } = useConnection()
const { mutateAsync: signMessageAsync } = useSignMessage()
const { mutate: disconnectAccount } = useDisconnect()

const userInitiated = ref(false)

function disconnect() {
  status.value = 'idle'
  errorMessage.value = ''
  disconnectAccount()
}

async function signIn() {
  if (!address.value || !chainId.value) return

  status.value = 'signing'
  errorMessage.value = ''

  try {
    const message = createSiweMessage({
      domain: window.location.host,
      address: address.value,
      uri: window.location.origin,
      chainId: chainId.value,
      nonce: props.uid,
      statement: 'Sign-In with Ethereum',
    })

    const signature = await signMessageAsync({ message })

    status.value = 'verifying'

    const response = await fetch(`/api/interaction/${props.uid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })

    // The server responds with a 302 that fetch follows automatically
    if (response.redirected) {
      window.location.href = response.url
      return
    }

    // Handle error responses
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ statusMessage: 'Verification failed' }))
      throw new Error(error.statusMessage || 'Verification failed')
    }
  } catch (err: unknown) {
    status.value = 'error'
    if (err instanceof Error) {
      if (/reject|denied|cancel/i.test(err.message)) {
        errorMessage.value = 'Signature rejected. Please try again.'
      } else {
        errorMessage.value = err.message
      }
    } else {
      errorMessage.value = 'An unknown error occurred.'
    }
    emit('error', errorMessage.value)
  }
}

// Auto-sign when user actively connects via EvmConnect
watch([isConnected, address], ([connected, addr]) => {
  if (connected && addr && status.value === 'idle' && userInitiated.value) {
    signIn()
  }
})
</script>

<template>
  <div class="siwe-login">
    <Loading
      v-if="status === 'signing'"
      spinner
      stacked
      :txt="
        connector?.name
          ? `Requesting signature from ${connector.name}...`
          : 'Requesting signature...'
      "
    />

    <Loading
      v-else-if="status === 'verifying'"
      spinner
      stacked
      txt="Verifying signature..."
    />

    <template v-else-if="isConnected && status === 'error'">
      <Alert type="error">
        <p>{{ errorMessage }}</p>
      </Alert>
      <Button
        class="danger block"
        @click="signIn"
      >
        Try again
      </Button>
    </template>

    <template v-if="isConnected && address">
      <Button
        v-if="status === 'idle'"
        class="primary block"
        @click="signIn"
      >
        Sign in with Ethereum
      </Button>
      <Button
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
      v-else-if="status !== 'verifying'"
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
