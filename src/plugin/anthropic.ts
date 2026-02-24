import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook } from '../types/plugin.js'

const log = createLogger('plugin:anthropic')

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const API_KEY_EXCHANGE_URL = 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference'
const OAUTH_BETA = 'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14'

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

interface CreateApiKeyResponse {
  raw_key?: string
}

function isOAuthToken(value: string): boolean {
  return value.startsWith('sk-ant-oat') || value.startsWith('sk-ant-ort')
}

function looksLikeApiKey(value: string): boolean {
  if (isOAuthToken(value)) return false
  return value.startsWith('sk-ant-')
}

function applyBearerHeaders(headers: Headers, token: string): void {
  headers.delete('x-api-key')
  headers.delete('authorization')
  headers.delete('Authorization')
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('anthropic-beta', OAUTH_BETA)
}

function toBase64Url(inputValue: Buffer): string {
  return inputValue.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32))
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function buildAuthorizationRequest(): { url: string; verifier: string; state: string } {
  const { verifier, challenge } = createPkce()
  const state = verifier
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('code', 'true')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', OAUTH_SCOPES)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return { url: url.toString(), verifier, state }
}

function openUrlInBrowser(url: string): void {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    log('failed to open browser automatically')
  }
}

async function readCallbackInput(question: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

function parseCallbackInput(value: string): { code?: string; state?: string } {
  const raw = value.trim()
  if (raw.length === 0) return {}

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      return {
        code: u.searchParams.get('code') ?? undefined,
        state: u.searchParams.get('state') ?? undefined,
      }
    } catch {
      return {}
    }
  }

  const maybeQuery = raw.startsWith('?') ? raw.slice(1) : raw
  if (maybeQuery.includes('=')) {
    const params = new URLSearchParams(maybeQuery)
    const code = params.get('code') ?? undefined
    const state = params.get('state') ?? undefined
    if (code !== undefined || state !== undefined) return { code, state }
  }

  return { code: raw }
}

async function exchangeAuthorizationCode(code: string, verifier: string, state: string): Promise<TokenResponse> {
  const res = await globalThis.fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic token exchange failed: ${res.status} ${res.statusText} ${body}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return {
    access_token: String(raw.access_token ?? ''),
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_in: typeof raw.expires_in === 'number' ? raw.expires_in : undefined,
  }
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await globalThis.fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })

  if (!res.ok) {
    throw new Error(`Anthropic token refresh failed: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return {
    access_token: String(raw.access_token ?? ''),
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_in: typeof raw.expires_in === 'number' ? raw.expires_in : undefined,
  }
}

async function createApiKeyFromOAuthAccessToken(accessToken: string): Promise<string> {
  const res = await globalThis.fetch(API_KEY_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: '{}',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API key exchange failed: ${res.status} ${res.statusText} ${body}`)
  }

  const raw = (await res.json()) as CreateApiKeyResponse
  if (typeof raw.raw_key !== 'string' || raw.raw_key.length === 0) {
    throw new Error('Anthropic API key exchange returned empty raw_key')
  }

  return raw.raw_key
}

/**
 * Resolve a fresh OAuth access_token from the credential, refreshing if expired.
 * Used both during loader setup and inside the per-request Bearer fallback fetch.
 * When a refresh occurs and setAuth is provided, the updated credential is persisted.
 */
async function resolveOAuthToken(
  auth: AuthCredential,
  setAuth?: (credential: AuthCredential) => Promise<void>,
): Promise<string | undefined> {
  let token = auth.key
  if (auth.expires !== undefined && auth.expires < Date.now() && typeof auth.refresh === 'string') {
    try {
      const refreshed = await refreshAccessToken(auth.refresh)
      token = refreshed.access_token
      if (setAuth) {
        const updated: AuthCredential = {
          ...auth,
          key: refreshed.access_token,
          refresh: refreshed.refresh_token ?? auth.refresh,
          expires: refreshed.expires_in !== undefined ? Date.now() + refreshed.expires_in * 1000 : undefined,
        }
        await setAuth(updated).catch((err) =>
          log('failed to persist refreshed credential: %s', err instanceof Error ? err.message : String(err)),
        )
      }
    } catch (error) {
      log('anthropic token refresh failed: %s', error instanceof Error ? error.message : String(error))
    }
  }
  return typeof token === 'string' && token.length > 0 ? token : undefined
}

// ---------------------------------------------------------------------------
// Anthropic auth supports two modes:
//
// 1. API key (type: 'api')
//    - key holds a direct API key (sk-ant-api03-xxx)
//    - The loader returns {} — no custom config needed, the SDK uses x-api-key
//      header automatically.
//
// 2. OAuth (type: 'oauth')
//    - key holds the short-lived access_token (sk-ant-oat-xxx)
//    - refresh holds the long-lived refresh_token (sk-ant-ort-xxx)
//    - expires is the absolute timestamp (ms) when the access_token expires
//    - The loader handles the full lifecycle:
//      a. If the access_token is expired and a refresh_token exists, refresh it
//      b. If the token looks like an API key (sk-ant- but not oat/ort), use as apiKey
//      c. Otherwise, exchange the OAuth access_token for an API key via
//         /api/oauth/claude_cli/create_api_key
//      d. If exchange fails, fall back to Bearer token auth with custom fetch
// ---------------------------------------------------------------------------
export const anthropicPlugin: AuthHook = {
  provider: 'anthropic',

  // API key auth: loader is a no-op — the SDK handles x-api-key header directly
  async loader(getAuth, _provider, setAuth) {
    const auth = await getAuth()
    if (auth.type !== 'oauth') return {}

    // OAuth: resolve a fresh token (refresh if expired), then try apiKey paths
    const token = await resolveOAuthToken(auth, setAuth)

    if (token !== undefined) {
      if (looksLikeApiKey(token)) {
        return { apiKey: token }
      }

      try {
        const apiKey = await createApiKeyFromOAuthAccessToken(token)
        return { apiKey }
      } catch (error) {
        log('anthropic api key exchange failed, using oauth bearer fallback: %s', String(error))
      }
    }

    // Bearer fallback: per-request token refresh (same pattern as google/codex plugins)
    return {
      headers: {
        'anthropic-beta': OAUTH_BETA,
      },
      async fetch(request: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) {
        const currentAuth = await getAuth()
        const bearerToken = await resolveOAuthToken(currentAuth, setAuth)
        const headers = new Headers(init?.headers)
        applyBearerHeaders(headers, bearerToken ?? '')
        return globalThis.fetch(request, { ...init, headers })
      },
    }
  },

  methods: [
    {
      type: 'oauth',
      label: 'Claude Pro/Max (Browser OAuth)',
      async handler(): Promise<AuthCredential> {
        const authRequest = buildAuthorizationRequest()
        console.log('Open this URL to continue Claude Pro/Max OAuth:')
        console.log(authRequest.url)
        openUrlInBrowser(authRequest.url)

        const callbackInput = await readCallbackInput('Paste the callback URL or authorization code: ')
        const parsed = parseCallbackInput(callbackInput)
        if (!parsed.code) throw new Error('Missing authorization code in callback input')
        if (parsed.state !== undefined && parsed.state !== authRequest.state) {
          throw new Error('OAuth state mismatch')
        }

        const tokens = await exchangeAuthorizationCode(parsed.code, authRequest.verifier, authRequest.state)
        return {
          type: 'oauth',
          key: tokens.access_token,
          refresh: tokens.refresh_token,
          expires: tokens.expires_in !== undefined ? Date.now() + tokens.expires_in * 1000 : undefined,
        }
      },
    },
  ],
}
