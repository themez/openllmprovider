import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook, ProviderInfo } from '../types/plugin.js'

const log = createLogger('plugin:google')

const GEMINI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GEMINI_CLIENT_SECRET = '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'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

async function refreshGoogleToken(refreshToken: string): Promise<TokenResponse> {
  log('refreshing Google OAuth token')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: GEMINI_CLIENT_ID,
    client_secret: GEMINI_CLIENT_SECRET,
  })

  const res = await globalThis.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return {
    access_token: String(raw.access_token ?? ''),
    expires_in: Number(raw.expires_in ?? 3600),
    token_type: String(raw.token_type ?? 'Bearer'),
  }
}

/**
 * Built-in auth plugin for Google AI (OAuth via gemini-cli credentials).
 *
 * Only activates for OAuth credentials. API key credentials fall through
 * with an empty options object so the standard @ai-sdk/google path handles them.
 *
 * When active the plugin:
 *  1. Sets a dummy apiKey so the SDK doesn't reject construction
 *  2. Wraps fetch to inject `Authorization: Bearer <access_token>`
 *  3. Removes `x-goog-api-key` header (conflicts with Bearer auth)
 *  4. Auto-refreshes expired tokens using the gemini-cli client credentials
 */
export const googlePlugin: AuthHook = {
  provider: 'google',

  async loader(getAuth: () => Promise<AuthCredential>, _provider: ProviderInfo): Promise<Record<string, unknown>> {
    const auth = await getAuth()

    if (auth.type !== 'oauth') {
      log('google loader: skipping (type=%s)', auth.type)
      return {}
    }

    log('google loader: activating OAuth fetch wrapper')

    let currentToken = auth.key ?? ''
    let tokenExpires = auth.expires ?? 0

    return {
      apiKey: 'google-oauth-placeholder',

      async fetch(
        input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
      ): Promise<Response> {
        if (tokenExpires > 0 && tokenExpires < Date.now() && typeof auth.refresh === 'string') {
          log('token expired, attempting refresh...')
          try {
            const tokens = await refreshGoogleToken(auth.refresh)
            currentToken = tokens.access_token
            tokenExpires = Date.now() + tokens.expires_in * 1000
            log('token refreshed successfully, expires in %ds', tokens.expires_in)
          } catch (err: unknown) {
            log('token refresh failed: %s', err instanceof Error ? err.message : String(err))
          }
        }

        const headers = new Headers(init?.headers)
        headers.delete('x-goog-api-key')
        headers.set('Authorization', `Bearer ${currentToken}`)

        return globalThis.fetch(input, { ...init, headers })
      },
    }
  },

  methods: [],
}
