export default defineAppConfig({
  evm: {
    chains: {
      mainnet: { id: 1, blockExplorer: 'https://etherscan.io' },
      arbitrum: { id: 42161, blockExplorer: 'https://arbiscan.io' },
      polygon: { id: 137, blockExplorer: 'https://polygonscan.com' },
    },
  },
})
