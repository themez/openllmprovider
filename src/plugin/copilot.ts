import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook } from '../types/plugin.js'

const log = createLogger('plugin:copilot')

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export const copilotPlugin: AuthHook = {
  provider: 'github-copilot',

  async loader(getAuth, _provider) {
    return {
      baseURL: 'https://api.githubcopilot.com',
      apiKey: '',
      async fetch(...[request, init]: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> {
        const auth = await getAuth()
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${auth.refresh ?? auth.key ?? ''}`)
        headers.set('Openai-Intent', 'conversation-edits')
        log('copilot fetch: injecting auth headers')
        return globalThis.fetch(request, { ...init, headers })
      },
    }
  },

  methods: [
    {
      type: 'device-flow',
      label: 'GitHub Copilot (Device Flow)',
      async handler(): Promise<AuthCredential> {
        log('starting device flow')
        const deviceRes = await globalThis.fetch(GITHUB_DEVICE_CODE_URL, {
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

        const deviceData = (await deviceRes.json()) as {
          device_code: string
          user_code: string
          verification_uri: string
          interval: number
        }

        log('device flow: user_code=%s, verification_uri=%s', deviceData.user_code, deviceData.verification_uri)

        const token = await pollForToken(deviceData.device_code, deviceData.interval)
        return {
          type: 'oauth',
          refresh: token,
        }
      },
    },
  ],
}

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000

  while (true) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval))

    const res = await globalThis.fetch(GITHUB_ACCESS_TOKEN_URL, {
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
