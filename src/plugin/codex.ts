import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook, AuthMethod, ProviderInfo } from '../types/plugin.js'

const log = createLogger('plugin:codex')

const OAUTH_DUMMY_KEY = 'codex-oauth-placeholder'
const OPENAI_AUTH_URL = 'https://auth0.openai.com'
const OPENAI_TOKEN_URL = `${OPENAI_AUTH_URL}/oauth/token`
const OPENAI_DEVICE_URL = `${OPENAI_AUTH_URL}/oauth/device/code`
const OPENAI_AUDIENCE = 'https://api.openai.com/v1'
// Placeholder: replace with the actual OpenAI OAuth client ID for Codex access
const CODEX_CLIENT_ID = 'app_placeholder_openai_client_id'

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

function parseTokenResponse(raw: Record<string, unknown>): TokenResponse {
  return {
    access_token: String(raw.access_token ?? ''),
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_in: Number(raw.expires_in ?? 3600),
    token_type: String(raw.token_type ?? 'Bearer'),
  }
}

/**
 * Poll the token endpoint until the device flow completes or times out.
 * Max ~10 minutes at 5-second polling intervals.
 */
async function pollForToken(deviceCode: string, intervalSeconds: number): Promise<TokenResponse> {
  const intervalMs = Math.max(intervalSeconds, 5) * 1000
  const maxPolls = 120

  for (let i = 0; i < maxPolls; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))

    const res = await globalThis.fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const raw = (await res.json()) as Record<string, unknown>

    if (typeof raw.error === 'string') {
      if (raw.error === 'authorization_pending' || raw.error === 'slow_down') {
        log('poll[%d]: %s, waiting...', i + 1, raw.error)
        continue
      }
      const desc = typeof raw.error_description === 'string' ? raw.error_description : ''
      throw new Error(`Device flow error: ${raw.error} — ${desc}`)
    }

    log('poll[%d]: token acquired', i + 1)
    return parseTokenResponse(raw)
  }

  throw new Error('Device flow timed out after polling limit reached')
}

/**
 * Exchange a refresh_token for a new access_token.
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  log('refreshing access token')

  const res = await globalThis.fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      audience: OPENAI_AUDIENCE,
    }),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return parseTokenResponse(raw)
}

/**
 * Built-in auth plugin for OpenAI Codex.
 *
 * Uses OAuth 2.0 device flow (no browser callback server).
 * The loader wraps the OpenAI SDK's fetch to:
 *  1. Strip the dummy API key Authorization header
 *  2. Auto-refresh expired tokens via refresh_token
 *  3. Inject `Authorization: Bearer <access_token>`
 *  4. Optionally forward a `ChatGPT-Account-Id` header
 */
export const codexPlugin: AuthHook = {
  provider: 'openai',

  async loader(getAuth: () => Promise<AuthCredential>, _provider: ProviderInfo): Promise<Record<string, unknown>> {
    return {
      apiKey: OAUTH_DUMMY_KEY,

      async fetch(
        request: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
      ): Promise<Response> {
        let auth = await getAuth()

        if (auth.expires !== undefined && auth.expires < Date.now() && auth.refresh) {
          log('token expired, attempting refresh...')
          try {
            const tokens = await refreshAccessToken(auth.refresh)
            auth = {
              ...auth,
              access: tokens.access_token,
              refresh: tokens.refresh_token ?? auth.refresh,
              expires: Date.now() + tokens.expires_in * 1000,
            }
            log('token refreshed successfully')
          } catch (err) {
            log('token refresh failed: %s', String(err))
            // Fall through and try with existing credentials
          }
        }

        const headers = new Headers(init?.headers)
        headers.delete('Authorization')

        const token = auth.access ?? auth.key ?? ''
        headers.set('Authorization', `Bearer ${token}`)

        const accountId = auth.accountId
        if (typeof accountId === 'string' && accountId.length > 0) {
          headers.set('ChatGPT-Account-Id', accountId)
        }

        log('codex fetch: OAuth headers injected')
        return globalThis.fetch(request, { ...init, headers })
      },
    }
  },

  methods: [
    {
      type: 'device-flow',
      label: 'OpenAI Codex (Device Flow)',

      async handler(): Promise<AuthCredential> {
        log('starting OpenAI device flow')

        const deviceRes = await globalThis.fetch(OPENAI_DEVICE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: CODEX_CLIENT_ID,
            audience: OPENAI_AUDIENCE,
            scope: 'openid profile email offline_access',
          }),
        })

        if (!deviceRes.ok) {
          throw new Error(`Device code request failed: ${deviceRes.status} ${deviceRes.statusText}`)
        }

        const deviceRaw = (await deviceRes.json()) as Record<string, unknown>
        const deviceCode = String(deviceRaw.device_code ?? '')
        const userCode = String(deviceRaw.user_code ?? '')
        const verificationUri = String(deviceRaw.verification_uri_complete ?? deviceRaw.verification_uri ?? '')
        const interval = Number(deviceRaw.interval ?? 5)

        log('device flow: user_code=%s', userCode)
        log('device flow: verify at %s', verificationUri)

        const tokens = await pollForToken(deviceCode, interval)

        return {
          type: 'oauth',
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          expires: Date.now() + tokens.expires_in * 1000,
        }
      },
    },
  ] satisfies AuthMethod[],
}
