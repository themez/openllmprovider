import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook } from '../types/plugin.js'

const log = createLogger('plugin:copilot')

const GITHUB_CLIENT_ID = 'Ov23li8tweQw6odWQebz'
const GITHUB_DEFAULT_DOMAIN = 'github.com'

function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function getUrls(domain: string): { deviceCodeUrl: string; accessTokenUrl: string } {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
  }
}

function resolveEnterpriseDomainFromEnv(): string {
  const raw = process.env.OPENLLMPROVIDER_COPILOT_ENTERPRISE_URL?.trim()
  if (!raw) {
    throw new Error(
      'Missing OPENLLMPROVIDER_COPILOT_ENTERPRISE_URL. Example: github.company.com or https://github.company.com'
    )
  }
  return normalizeDomain(raw)
}

async function runDeviceFlow(domain: string): Promise<AuthCredential> {
  const urls = getUrls(domain)
  const deviceRes = await globalThis.fetch(urls.deviceCodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user',
    }),
  })

  if (!deviceRes.ok) {
    const body = await deviceRes.text()
    throw new Error(`Device flow init failed: ${deviceRes.status} ${deviceRes.statusText} ${body}`)
  }

  const deviceData = (await deviceRes.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
  }

  log(
    'device flow: domain=%s user_code=%s verification_uri=%s',
    domain,
    deviceData.user_code,
    deviceData.verification_uri
  )
  const token = await pollForToken(urls.accessTokenUrl, deviceData.device_code, deviceData.interval)

  return {
    type: 'oauth',
    refresh: token,
    key: token,
    expires: 0,
    ...(domain !== GITHUB_DEFAULT_DOMAIN ? { enterpriseUrl: domain } : {}),
  }
}

export const copilotPlugin: AuthHook = {
  provider: 'github-copilot',

  async loader(getAuth, _provider) {
    const auth = await getAuth()
    const enterpriseUrl = typeof auth.enterpriseUrl === 'string' ? auth.enterpriseUrl : undefined
    const baseURL = enterpriseUrl
      ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}`
      : 'https://api.githubcopilot.com'

    return {
      baseURL,
      apiKey: '',
      async fetch(...[request, init]: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> {
        const auth = await getAuth()
        const headers = new Headers(init?.headers)
        // Remove SDK-set auth headers
        headers.delete('x-api-key')
        headers.delete('Authorization')
        // Set copilot-specific auth
        headers.set('Authorization', `Bearer ${auth.refresh ?? auth.key ?? ''}`)
        headers.set('Openai-Intent', 'conversation-edits')
        log('copilot fetch: injecting auth headers')
        return globalThis.fetch(request, { ...init, headers })
      },
    }
  },

  methods: [
    {
      type: 'oauth',
      label: 'GitHub Copilot (GitHub.com)',
      async handler(): Promise<AuthCredential> {
        log('starting github.com device flow')
        return runDeviceFlow(GITHUB_DEFAULT_DOMAIN)
      },
    },
    {
      type: 'device-flow',
      label: 'GitHub Copilot Enterprise (Device Flow)',
      async handler(): Promise<AuthCredential> {
        log('starting enterprise device flow')
        const domain = resolveEnterpriseDomainFromEnv()
        return runDeviceFlow(domain)
      },
    },
  ],
}

async function pollForToken(accessTokenUrl: string, deviceCode: string, interval: number): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000

  while (true) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval))

    const res = await globalThis.fetch(accessTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data = (await res.json()) as { access_token?: string; error?: string }

    if (data.access_token) {
      log('device flow: token obtained')
      return data.access_token
    }

    if (data.error === 'authorization_pending') {
      log('device flow: waiting for user authorization...')
      continue
    }

    if (data.error === 'slow_down') {
      log('device flow: slowing down')
      await new Promise<void>((resolve) => setTimeout(resolve, 5000))
      continue
    }

    throw new Error(`Device flow failed: ${data.error ?? 'unknown error'}`)
  }
}
