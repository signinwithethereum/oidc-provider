export default defineAppConfig({
  evm: {
    defaultChain: 'mainnet',
    appLogoUrl: 'https://oidc.siwe.xyz/favicon.png',
    chains: {
      mainnet: {
        id: 1,
        blockExplorer: 'https://etherscan.io',
      },
    },
  },
})
