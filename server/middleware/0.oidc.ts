import { fromNodeMiddleware } from 'h3'
import { getProvider } from '../utils/provider'

const OIDC_PATHS = [
  '/.well-known/openid-configuration',
  '/.well-known/webfinger',
  '/auth',
  '/token',
  '/me',
  '/jwks',
  '/reg',
  '/session/end',
]

let handler: ReturnType<typeof fromNodeMiddleware> | undefined

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? event.path

  if (!OIDC_PATHS.some((p) => path === p || path.startsWith(p + '/'))) return

  if (!handler) {
    const provider = await getProvider()
    handler = fromNodeMiddleware(provider.callback())
  }

  return handler(event)
})
