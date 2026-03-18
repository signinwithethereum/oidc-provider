import { getProvider } from '../../utils/provider'

export default defineEventHandler(async (event) => {
  const provider = await getProvider()
  const { node: { req, res } } = event

  try {
    const details = await provider.interactionDetails(req, res)
    return {
      uid: details.uid,
      prompt: details.prompt,
      params: {
        client_id: details.params.client_id,
        scope: details.params.scope,
        redirect_uri: details.params.redirect_uri,
      },
    }
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid interaction session',
    })
  }
})
