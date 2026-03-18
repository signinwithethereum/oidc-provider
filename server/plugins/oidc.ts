import { getProvider, seedDefaultClients } from '../utils/provider'

export default defineNitroPlugin(async () => {
  await getProvider()
  await seedDefaultClients()
})
