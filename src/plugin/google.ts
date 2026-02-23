import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook, ProviderInfo } from '../types/plugin.js'

const log = createLogger('plugin:google')

const GEMINI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GEMINI_CLIENT_SECRET = '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'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
const GEMINI_REDIRECT_URI = 'http://localhost:8085/oauth2callback'
const GEMINI_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
const CODE_ASSIST_HEADERS = {
  'User-Agent': 'google-api-nodejs-client/9.15.1',
  'X-Goog-Api-Client': 'gl-node/22.17.0',
  'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

function resolveProjectId(): string {
  const explicit = process.env.OPENLLMPROVIDER_GOOGLE_PROJECT_ID?.trim()
  if (explicit) return explicit
  const gcp = process.env.GOOGLE_CLOUD_PROJECT?.trim() ?? process.env.GOOGLE_CLOUD_PROJECT_ID?.trim()
  if (gcp) return gcp
  return ''
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
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_in: Number(raw.expires_in ?? 3600),
    token_type: String(raw.token_type ?? 'Bearer'),
  }
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
  const state = toBase64Url(randomBytes(24))

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', GEMINI_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', GEMINI_REDIRECT_URI)
  url.searchParams.set('scope', GEMINI_SCOPES.join(' '))
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  return { url: url.toString(), verifier, state }
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
    if (code !== undefined || state !== undefined) {
      return { code, state }
    }
  }

  return { code: raw }
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

async function exchangeAuthorizationCode(code: string, verifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: GEMINI_CLIENT_ID,
    client_secret: GEMINI_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: GEMINI_REDIRECT_URI,
    code_verifier: verifier,
  })

  const res = await globalThis.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const bodyText = await res.text()
    throw new Error(`Google token exchange failed: ${res.status} ${res.statusText} ${bodyText}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  return {
    access_token: String(raw.access_token ?? ''),
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_in: Number(raw.expires_in ?? 3600),
    token_type: String(raw.token_type ?? 'Bearer'),
  }
}

async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  const res = await globalThis.fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return undefined
  const raw = (await res.json()) as Record<string, unknown>
  return typeof raw.email === 'string' ? raw.email : undefined
}

type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = Parameters<typeof globalThis.fetch>[1]
type FetchBody = NonNullable<FetchInit>['body']

function toRequestUrlString(value: FetchInput | URL): string {
  if (typeof value === 'string') return value
  if (value instanceof URL) return value.toString()
  return value.url
}

function parseGenerativeAction(
  input: FetchInput | URL
): { model: string; action: string; streaming: boolean } | undefined {
  const url = toRequestUrlString(input)
  const match = url.match(/\/models\/([^:]+):(\w+)/)
  if (!match) return undefined
  const model = match[1] ?? ''
  const action = match[2] ?? ''
  if (!model || !action) return undefined
  return { model, action, streaming: action === 'streamGenerateContent' }
}

function buildCodeAssistUrl(action: string, streaming: boolean): string {
  return `${CODE_ASSIST_ENDPOINT}/v1internal:${action}${streaming ? '?alt=sse' : ''}`
}

function rewriteRequestBody(body: FetchBody, projectId: string, model: string): FetchBody {
  if (typeof body !== 'string' || body.length === 0) return body
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (typeof parsed.project === 'string' && parsed.request !== undefined) {
      const wrapped = { ...parsed, model }
      return JSON.stringify(wrapped)
    }
    const { model: _ignored, ...requestPayload } = parsed
    const userPromptId = randomUUID()
    const wrapped = {
      project: projectId,
      model,
      user_prompt_id: userPromptId,
      request: requestPayload,
    }
    return JSON.stringify(wrapped)
  } catch {
    return body
  }
}

function rewriteStreamingLine(line: string): string {
  if (!line.startsWith('data:')) return line
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return line
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const response = parsed.response
    if (response !== undefined) {
      return `data: ${JSON.stringify(response)}`
    }
    return line
  } catch {
    return line
  }
}

function rewriteStreamingBody(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx = buffer.indexOf('\n')
          while (idx !== -1) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            controller.enqueue(encoder.encode(`${rewriteStreamingLine(line)}\n`))
            idx = buffer.indexOf('\n')
          }
        }
        buffer += decoder.decode()
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(rewriteStreamingLine(buffer)))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

async function normalizeCodeAssistResponse(response: Response, streaming: boolean): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? ''

  if (streaming && response.ok && contentType.includes('text/event-stream') && response.body) {
    return new Response(rewriteStreamingBody(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  }

  if (!contentType.includes('application/json')) {
    return response
  }

  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const next = parsed.response
    if (next !== undefined) {
      return new Response(JSON.stringify(next), {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      })
    }
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  }
}

export const googlePlugin: AuthHook = {
  provider: 'google',

  async loader(getAuth: () => Promise<AuthCredential>, _provider: ProviderInfo): Promise<Record<string, unknown>> {
    const initialAuth = await getAuth()

    if (initialAuth.type !== 'oauth') {
      log('google loader: skipping (type=%s)', initialAuth.type)
      return {}
    }

    log('google loader: activating OAuth fetch wrapper')

    return {
      apiKey: 'google-oauth-placeholder',

      async fetch(
        inputValue: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
      ): Promise<Response> {
        const latestAuth = await getAuth()

        if (latestAuth.type !== 'oauth') {
          return globalThis.fetch(inputValue, init)
        }

        let currentToken = latestAuth.key ?? ''
        if (
          latestAuth.expires !== undefined &&
          latestAuth.expires < Date.now() &&
          typeof latestAuth.refresh === 'string'
        ) {
          log('token expired, attempting refresh...')
          try {
            const tokens = await refreshGoogleToken(latestAuth.refresh)
            currentToken = tokens.access_token
            log('token refreshed successfully, expires in %ds', tokens.expires_in)
          } catch (err: unknown) {
            log('token refresh failed: %s', err instanceof Error ? err.message : String(err))
          }
        }

        const rewritten = parseGenerativeAction(inputValue)
        if (!rewritten) {
          const headers = new Headers(init?.headers)
          headers.delete('x-goog-api-key')
          headers.delete('x-api-key')
          headers.set('Authorization', `Bearer ${currentToken}`)
          return globalThis.fetch(inputValue, { ...init, headers })
        }

        const projectId = resolveProjectId()
        if (!projectId) {
          throw new Error(
            'Google OAuth via Code Assist requires project id. Set OPENLLMPROVIDER_GOOGLE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT).'
          )
        }

        const headers = new Headers(init?.headers)
        headers.delete('x-goog-api-key')
        headers.delete('x-api-key')
        headers.set('Authorization', `Bearer ${currentToken}`)
        headers.set('User-Agent', CODE_ASSIST_HEADERS['User-Agent'])
        headers.set('X-Goog-Api-Client', CODE_ASSIST_HEADERS['X-Goog-Api-Client'])
        headers.set('Client-Metadata', CODE_ASSIST_HEADERS['Client-Metadata'])
        headers.set('x-activity-request-id', randomUUID())
        if (rewritten.streaming) {
          headers.set('Accept', 'text/event-stream')
        }

        const requestUrl = buildCodeAssistUrl(rewritten.action, rewritten.streaming)
        const body = rewriteRequestBody(init?.body, projectId, rewritten.model)
        const response = await globalThis.fetch(requestUrl, {
          ...init,
          headers,
          body,
        })

        return normalizeCodeAssistResponse(response, rewritten.streaming)
      },
    }
  },

  methods: [
    {
      type: 'oauth',
      label: 'Google OAuth (Gemini)',
      async handler(): Promise<AuthCredential> {
        const authRequest = buildAuthorizationRequest()

        console.log('Open this URL to continue Google OAuth:')
        console.log(authRequest.url)
        openUrlInBrowser(authRequest.url)

        const callbackInput = await readCallbackInput('Paste the callback URL or authorization code: ')
        const parsed = parseCallbackInput(callbackInput)
        if (!parsed.code) {
          throw new Error('Missing authorization code in callback input')
        }
        if (parsed.state !== undefined && parsed.state !== authRequest.state) {
          throw new Error('OAuth state mismatch')
        }

        const tokens = await exchangeAuthorizationCode(parsed.code, authRequest.verifier)
        if (!tokens.refresh_token) {
          throw new Error('Google OAuth did not return a refresh token; retry and grant consent')
        }

        const email = await fetchGoogleEmail(tokens.access_token)

        return {
          type: 'oauth',
          key: tokens.access_token,
          refresh: tokens.refresh_token,
          expires: Date.now() + tokens.expires_in * 1000,
          email,
        }
      },
    },
  ],
}
