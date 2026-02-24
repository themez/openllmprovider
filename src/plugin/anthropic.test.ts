import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AuthCredential } from '../types/plugin.js'
import { anthropicPlugin } from './anthropic.js'

// ---------------------------------------------------------------------------
// Anthropic plugin supports two auth modes. These tests verify the loader
// behavior for each:
//
// 1. API key auth (type: 'api')
//    - The loader returns {} immediately — no custom SDK config needed.
//    - The SDK uses the `key` field via the standard x-api-key header.
//
// 2. OAuth auth (type: 'oauth')
//    - The loader inspects the credential and may:
//      a. Refresh an expired access_token using the refresh_token
//      b. Use a token directly as apiKey if it looks like an API key (sk-ant-*)
//      c. Exchange an OAuth access_token for a real API key via Anthropic API
//      d. Fall back to Bearer token auth with a custom fetch wrapper
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

beforeEach(() => {
  // Reset fetch mock before each test
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function makeGetAuth(credential: AuthCredential) {
  return async () => credential
}

// =====================================================================
// 1. API key auth
// =====================================================================
describe('anthropic loader — API key auth', () => {
  it('returns empty config for type=api (SDK handles x-api-key automatically)', async () => {
    const getAuth = makeGetAuth({
      type: 'api',
      key: 'sk-ant-api03-test-key',
    })

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({})
  })

  it('returns empty config for type=wellknown', async () => {
    const getAuth = makeGetAuth({
      type: 'wellknown',
      key: 'sk-ant-api03-discovered-key',
    })

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({})
  })
})

// =====================================================================
// 2. OAuth auth
// =====================================================================
describe('anthropic loader — OAuth auth', () => {
  it('uses token as apiKey when it looks like an API key (sk-ant-api03-*)', async () => {
    // After OAuth flow, the token was already exchanged for an API key and
    // stored back in `key`. On next load, it looks like an API key directly.
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-api03-already-exchanged',
      expires: Date.now() + 3600_000, // not expired
    })

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({ apiKey: 'sk-ant-api03-already-exchanged' })
  })

  it('exchanges OAuth access_token for API key via create_api_key endpoint', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-valid-access-token',
      refresh: 'sk-ant-ort-valid-refresh-token',
      expires: Date.now() + 3600_000, // not expired
    })

    // Mock the API key exchange endpoint
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-exchanged-key' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({ apiKey: 'sk-ant-api03-exchanged-key' })
  })

  it('refreshes expired token before exchanging for API key', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-expired-access-token',
      refresh: 'sk-ant-ort-valid-refresh-token',
      expires: Date.now() - 1000, // already expired
    })

    const fetchCalls: string[] = []

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      fetchCalls.push(urlStr)

      // Token refresh endpoint
      if (urlStr.includes('/v1/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'sk-ant-oat-refreshed-token',
            refresh_token: 'sk-ant-ort-new-refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // API key exchange endpoint (called with refreshed token)
      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-from-refreshed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})

    // Should have called refresh first, then exchange
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]).toContain('/v1/oauth/token')
    expect(fetchCalls[1]).toContain('create_api_key')
    expect(result).toEqual({ apiKey: 'sk-ant-api03-from-refreshed' })
  })

  it('falls back to Bearer auth when API key exchange fails', async () => {
    const credential: AuthCredential = {
      type: 'oauth',
      key: 'sk-ant-oat-valid-but-exchange-fails',
      expires: Date.now() + 3600_000,
    }
    const getAuth = makeGetAuth(credential)

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url

      // API key exchange fails
      if (urlStr.includes('create_api_key')) {
        return new Response('Forbidden', { status: 403 })
      }

      // The fallback custom fetch — just return a dummy response
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})

    // Should return headers + custom fetch (Bearer fallback)
    expect(result).toHaveProperty('headers')
    expect(result).toHaveProperty('fetch')
    expect((result.headers as Record<string, string>)['anthropic-beta']).toBeDefined()
  })

  it('falls back to Bearer auth when token is empty after refresh failure', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: undefined, // no access token
      refresh: 'sk-ant-ort-valid-refresh-token',
      expires: Date.now() - 1000, // expired
    })

    globalThis.fetch = mock(async () => {
      // Refresh fails
      return new Response('Server Error', { status: 500 })
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})

    // No valid token — falls through to Bearer fallback
    expect(result).toHaveProperty('headers')
    expect(result).toHaveProperty('fetch')
  })

  it('does not refresh when token is not expired', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-still-valid',
      refresh: 'sk-ant-ort-should-not-be-used',
      expires: Date.now() + 3600_000, // still valid
    })

    const fetchCalls: string[] = []

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      fetchCalls.push(urlStr)

      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-from-valid' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})

    // Should NOT call refresh endpoint — only API key exchange
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toContain('create_api_key')
    expect(result).toEqual({ apiKey: 'sk-ant-api03-from-valid' })
  })
})


// =====================================================================
// Bearer fallback: per-request token refresh (the bug that was fixed)
// =====================================================================
describe('anthropic loader — Bearer fallback refresh', () => {
  it('refreshes expired token inside fallback fetch (not just at loader setup)', async () => {
    // This is the core bug scenario: token is expired, API key exchange fails,
    // the Bearer fallback fetch MUST refresh the token per-request (like google/codex).
    // Previously, the fallback just used getAuth().key directly — the old expired token.
    const storedAuth: AuthCredential = {
      type: 'oauth',
      key: 'sk-ant-oat-expired-token',
      refresh: 'sk-ant-ort-valid-refresh',
      expires: Date.now() - 1000,
    }
    const getAuth = makeGetAuth(storedAuth)

    let phase: 'loader' | 'fetch' = 'loader'
    const fetchCalls: string[] = []

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      fetchCalls.push(urlStr)

      if (urlStr.includes('/v1/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'sk-ant-oat-fresh-token',
            refresh_token: 'sk-ant-ort-new-refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (urlStr.includes('create_api_key')) {
        return new Response('Forbidden', { status: 403 })
      }

      if (phase === 'fetch') {
        // Actual API call — verify it uses the refreshed token
        const authHeader = init?.headers instanceof Headers
          ? init.headers.get('Authorization')
          : undefined
        expect(authHeader).toBe('Bearer sk-ant-oat-fresh-token')
        return new Response('ok', { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    // Step 1: loader runs — refresh + exchange fail → Bearer fallback returned
    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toHaveProperty('fetch')
    const customFetch = result.fetch as typeof globalThis.fetch

    // Step 2: simulate an API call through the fallback fetch
    phase = 'fetch'
    fetchCalls.length = 0
    await customFetch('https://api.anthropic.com/v1/messages', {})

    // The fallback fetch should have refreshed the token before the API call
    expect(fetchCalls[0]).toContain('/v1/oauth/token')
  })

  it('uses non-expired token as-is in fallback fetch (no unnecessary refresh)', async () => {
    // exchange fails → Bearer fallback, but token is still valid → no refresh in fetch
    const storedAuth: AuthCredential = {
      type: 'oauth',
      key: 'sk-ant-oat-still-valid',
      expires: Date.now() + 3600_000,
    }
    const getAuth = makeGetAuth(storedAuth)

    let phase: 'loader' | 'fetch' = 'loader'
    const fetchCalls: string[] = []

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      fetchCalls.push(urlStr)

      if (urlStr.includes('create_api_key')) {
        return new Response('Forbidden', { status: 403 })
      }

      if (phase === 'fetch') {
        const authHeader = init?.headers instanceof Headers
          ? init.headers.get('Authorization')
          : undefined
        expect(authHeader).toBe('Bearer sk-ant-oat-still-valid')
        return new Response('ok', { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toHaveProperty('fetch')
    const customFetch = result.fetch as typeof globalThis.fetch

    phase = 'fetch'
    fetchCalls.length = 0
    await customFetch('https://api.anthropic.com/v1/messages', {})

    // No refresh call — only the actual API call
    expect(fetchCalls.every((u) => !u.includes('/v1/oauth/token'))).toBe(true)
  })
})
// =====================================================================
// Token type detection helpers
// =====================================================================
describe('anthropic loader — token type detection', () => {
  it('recognizes sk-ant-oat-* as OAuth token (not API key)', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-some-oauth-token',
      expires: Date.now() + 3600_000,
    })

    // If it were treated as API key, it would return { apiKey: ... } without
    // calling create_api_key. Since it's an OAuth token, it should call the
    // exchange endpoint.
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-exchanged' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({ apiKey: 'sk-ant-api03-exchanged' })
  })

  it('recognizes sk-ant-api03-* as direct API key (skips exchange)', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-api03-direct-key',
      expires: Date.now() + 3600_000,
    })

    // fetch should never be called since the token is recognized as an API key
    globalThis.fetch = mock(async () => {
      throw new Error('fetch should not be called for API key tokens')
    }) as unknown as typeof fetch

    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, async () => {})
    expect(result).toEqual({ apiKey: 'sk-ant-api03-direct-key' })
  })
})


// =====================================================================
// setAuth persistence: verify refreshed tokens are written back
// =====================================================================
describe('anthropic loader — setAuth persistence', () => {
  it('calls setAuth with refreshed credential when token is expired (loader path)', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-expired',
      refresh: 'sk-ant-ort-refresh',
      expires: Date.now() - 1000,
    })

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('/v1/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'sk-ant-oat-new-access',
            refresh_token: 'sk-ant-ort-new-refresh',
            expires_in: 7200,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-exchanged' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const persisted: AuthCredential[] = []
    const setAuth = async (cred: AuthCredential) => { persisted.push(cred) }

    await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, setAuth)

    expect(persisted).toHaveLength(1)
    expect(persisted[0].key).toBe('sk-ant-oat-new-access')
    expect(persisted[0].refresh).toBe('sk-ant-ort-new-refresh')
    expect(persisted[0].type).toBe('oauth')
    expect(typeof persisted[0].expires).toBe('number')
  })

  it('calls setAuth in Bearer fallback fetch when token is refreshed', async () => {
    const storedAuth: AuthCredential = {
      type: 'oauth',
      key: 'sk-ant-oat-expired-bearer',
      refresh: 'sk-ant-ort-refresh-bearer',
      expires: Date.now() - 1000,
    }
    const getAuth = makeGetAuth(storedAuth)

    let phase: 'loader' | 'fetch' = 'loader'

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('/v1/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'sk-ant-oat-bearer-refreshed',
            refresh_token: 'sk-ant-ort-bearer-new',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (urlStr.includes('create_api_key')) {
        return new Response('Forbidden', { status: 403 })
      }
      if (phase === 'fetch') {
        return new Response('ok', { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const persisted: AuthCredential[] = []
    const setAuth = async (cred: AuthCredential) => { persisted.push(cred) }

    // Loader: refresh + exchange fail → Bearer fallback
    const result = await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, setAuth)
    const loaderPersistCount = persisted.length
    expect(loaderPersistCount).toBe(1) // refresh during loader setup

    // Fetch: triggers another refresh (getAuth returns expired token again)
    phase = 'fetch'
    const customFetch = result.fetch as typeof globalThis.fetch
    await customFetch('https://api.anthropic.com/v1/messages', {})

    expect(persisted.length).toBeGreaterThan(loaderPersistCount)
    expect(persisted[persisted.length - 1].key).toBe('sk-ant-oat-bearer-refreshed')
  })

  it('does not call setAuth when token is not expired', async () => {
    const getAuth = makeGetAuth({
      type: 'oauth',
      key: 'sk-ant-oat-still-good',
      refresh: 'sk-ant-ort-not-needed',
      expires: Date.now() + 3600_000,
    })

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (urlStr.includes('create_api_key')) {
        return new Response(JSON.stringify({ raw_key: 'sk-ant-api03-from-valid' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${urlStr}`)
    }) as unknown as typeof fetch

    const persisted: AuthCredential[] = []
    const setAuth = async (cred: AuthCredential) => { persisted.push(cred) }

    await anthropicPlugin.loader(getAuth, { id: 'anthropic' }, setAuth)

    // No refresh happened, so setAuth should not be called
    expect(persisted).toHaveLength(0)
  })
})
