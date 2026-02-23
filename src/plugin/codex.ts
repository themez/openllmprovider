import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook, AuthMethod, ProviderInfo } from '../types/plugin.js'

const log = createLogger('plugin:codex')

const OAUTH_DUMMY_KEY = 'codex-oauth-placeholder'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const OPENAI_TOKEN_URL = `${ISSUER}/oauth/token`
const OPENAI_DEVICE_URL = `${ISSUER}/oauth/device/code`
const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

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
 * Decode a JWT payload (base64url) and return claims as a plain object.
 * Returns undefined if the token is not a valid JWT.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = parts[1]
    // base64url → base64 → decode
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '==='.slice((base64.length + 3) % 4)
    const decoded = atob(padded)
    const parsed: unknown = JSON.parse(decoded)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // malformed JWT — ignore
  }
  return undefined
}

/**
 * Extract the ChatGPT account ID from an OpenAI OAuth JWT access token.
 * The claim is nested: token["https://api.openai.com/auth"]["chatgpt_account_id"]
 */
function extractAccountIdFromJwt(token: string): string | undefined {
  const claims = decodeJwtPayload(token)
  if (claims === undefined) return undefined
  const authClaim = claims['https://api.openai.com/auth']
  if (authClaim !== null && typeof authClaim === 'object' && !Array.isArray(authClaim)) {
    const id = (authClaim as Record<string, unknown>).chatgpt_account_id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
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

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    const res = await globalThis.fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
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
 * Exchange a refresh_token for a new access_token using form-urlencoded POST.
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  log('refreshing access token')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  })

  const res = await globalThis.fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return parseTokenResponse(raw)
}

/**
 * Check if a request URL should be rewritten to the Codex endpoint.
 */
function shouldRewriteUrl(input: Parameters<typeof globalThis.fetch>[0]): boolean {
  let url: URL
  try {
    if (input instanceof Request) {
      url = new URL(input.url)
    } else {
      url = new URL(String(input))
    }
  } catch {
    return false
  }
  const pathname = url.pathname
  return pathname.includes('/v1/responses') || pathname.includes('/chat/completions')
}

/**
 * Buffer a streaming SSE response from the Codex endpoint and extract the
 * final response.completed event into a synthetic Responses API JSON object.
 */
async function bufferCodexStream(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const lines = text.split('\n')
  let lastResponseData: Record<string, unknown> | undefined

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const jsonStr = line.slice(6)
    if (jsonStr === '[DONE]') break
    try {
      const event: unknown = JSON.parse(jsonStr)
      if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
        const e = event as Record<string, unknown>
        // The response.completed or response.done event contains the full response
        if (e.type === 'response.completed' || e.type === 'response.done') {
          const resp = e.response
          if (resp !== null && typeof resp === 'object' && !Array.isArray(resp)) {
            lastResponseData = resp as Record<string, unknown>
          }
        }
      }
    } catch {
      // Malformed SSE line — skip
    }
  }

  if (lastResponseData !== undefined) {
    return lastResponseData
  }

  // Fallback: return a minimal error response
  log('bufferCodexStream: no response.completed event found in SSE stream')
  return { error: { message: 'Failed to parse streaming response from Codex endpoint' } }
}

/**
 * Built-in auth plugin for OpenAI Codex (OAuth).
 *
 * Only activates for OAuth credentials (`auth.type === 'oauth'`). API key
 * credentials fall through with an empty options object so the standard
 * OpenAI SDK path handles them.
 *
 * When active the plugin:
 *  1. Sets a dummy apiKey so the SDK doesn't reject construction
 *  2. Wraps fetch to auto-refresh expired tokens via refresh_token
 *  3. Injects `Authorization: Bearer <access_token>`
 *  4. Sets `ChatGPT-Account-Id` from stored accountId or JWT claims
 *  5. Rewrites `/v1/responses` and `/chat/completions` URLs to the Codex endpoint
 */
export const codexPlugin: AuthHook = {
  provider: 'openai',

  async loader(getAuth: () => Promise<AuthCredential>, _provider: ProviderInfo): Promise<Record<string, unknown>> {
    const auth = await getAuth()

    // Only intercept OAuth credentials — API keys use the standard SDK path
    if (auth.type !== 'oauth') {
      log('codex loader: skipping (type=%s)', auth.type)
      return {}
    }

    log('codex loader: activating OAuth fetch wrapper')

    return {
      apiKey: OAUTH_DUMMY_KEY,

      async fetch(
        request: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
      ): Promise<Response> {
        let currentAuth = await getAuth()

        if (
          currentAuth.expires !== undefined &&
          currentAuth.expires < Date.now() &&
          typeof currentAuth.refresh === 'string'
        ) {
          log('token expired, attempting refresh...')
          try {
            const tokens = await refreshAccessToken(currentAuth.refresh)
            currentAuth = {
              ...currentAuth,
              key: tokens.access_token,
              refresh: tokens.refresh_token ?? currentAuth.refresh,
              expires: Date.now() + tokens.expires_in * 1000,
            }
            log('token refreshed successfully')
          } catch (err: unknown) {
            log('token refresh failed: %s', err instanceof Error ? err.message : String(err))
            // Fall through and try with existing credentials
          }
        }

        const headers = new Headers(init?.headers)
        headers.delete('Authorization')

        const token = currentAuth.key ?? ''
        headers.set('Authorization', `Bearer ${token}`)

        let accountId = typeof currentAuth.accountId === 'string' ? currentAuth.accountId : undefined
        if (accountId === undefined && token.length > 0) {
          accountId = extractAccountIdFromJwt(token)
        }
        if (typeof accountId === 'string' && accountId.length > 0) {
          headers.set('ChatGPT-Account-Id', accountId)
        }

        const isCodexRewrite = shouldRewriteUrl(request)
        const rewritten = isCodexRewrite ? CODEX_API_ENDPOINT : request

        // The Codex backend requires store=false, instructions, and stream=true.
        // Patch the request body when routing to the codex endpoint.
        let patchedInit = init
        let needsStreamBuffer = false
        if (isCodexRewrite && init?.body) {
          try {
            const bodyStr =
              typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)
            const parsed: unknown = JSON.parse(bodyStr)
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const body = parsed as Record<string, unknown>
              if (body.store !== false) body.store = false
              if (typeof body.instructions !== 'string' || body.instructions.length === 0) {
                body.instructions = 'You are a helpful assistant.'
              }
              // Codex endpoint only supports streaming. If the SDK requested
              // non-streaming, force stream=true and buffer the SSE response.
              if (body.stream !== true) {
                body.stream = true
                needsStreamBuffer = true
              }
              patchedInit = { ...init, body: JSON.stringify(body) }
            }
          } catch {
            // If we can't parse the body, send it as-is
          }
        }

        log('codex fetch: rewritten=%s, needsStreamBuffer=%s', isCodexRewrite, needsStreamBuffer)
        const response = await globalThis.fetch(rewritten, { ...patchedInit, headers })

        // If we forced streaming, buffer the SSE response and return a
        // synthetic JSON response that matches the Responses API format.
        if (needsStreamBuffer && response.ok && response.body) {
          const syntheticBody = await bufferCodexStream(response)
          return new Response(JSON.stringify(syntheticBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return response
      },
    }
  },

  methods: [
    {
      type: 'device-flow',
      label: 'OpenAI Codex (Device Flow)',

      async handler(): Promise<AuthCredential> {
        log('starting OpenAI device flow')

        const body = new URLSearchParams({
          client_id: CLIENT_ID,
          scope: 'openid profile email offline_access',
        })

        const deviceRes = await globalThis.fetch(OPENAI_DEVICE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
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
          key: tokens.access_token,
          refresh: tokens.refresh_token,
          expires: Date.now() + tokens.expires_in * 1000,
        }
      },
    },
  ] satisfies AuthMethod[],
}
