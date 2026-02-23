import { createLogger } from '../logger.js'

const log = createLogger('auth:scanners')

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface DiskScanResult {
  providerId: string
  source: string
  key?: string
  credentialType?: 'api' | 'oauth' | 'wellknown'
}

export interface DiskScanner {
  name: string
  scan(ctx: ScanContext): Promise<DiskScanResult[]>
}

export interface ScanContext {
  readFile(path: string): Promise<string | undefined>
  homedir(): string
  platform(): string
  env(name: string): string | undefined
}

// ---------------------------------------------------------------------------
// Default ScanContext (Node.js)
// ---------------------------------------------------------------------------

export function createNodeScanContext(): ScanContext {
  return {
    async readFile(path: string): Promise<string | undefined> {
      try {
        const fs = await import('node:fs/promises')
        return await fs.readFile(path, 'utf-8')
      } catch {
        return undefined
      }
    },
    homedir(): string {
      return process.env.HOME ?? process.env.USERPROFILE ?? ''
    },
    platform(): string {
      return process.platform
    },
    env(name: string): string | undefined {
      return process.env[name]
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function join(base: string, ...segments: string[]): string {
  return [base, ...segments].join('/')
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function stripJsonComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function readJson(ctx: ScanContext, path: string): Promise<Record<string, unknown> | undefined> {
  const raw = await ctx.readFile(path)
  if (!raw) return undefined
  return parseJson(raw) ?? parseJson(stripJsonComments(raw))
}

function configDir(ctx: ScanContext): string {
  const xdg = ctx.env('XDG_CONFIG_HOME')
  if (xdg) return xdg
  return join(ctx.homedir(), '.config')
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

const copilotScanner: DiskScanner = {
  name: 'github-copilot',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const base = join(configDir(ctx), 'github-copilot')
    const files = ['hosts.json', 'apps.json']

    for (const file of files) {
      const path = join(base, file)
      const json = await readJson(ctx, path)
      if (!json) continue

      for (const [key, value] of Object.entries(json)) {
        if (!key.includes('github.com')) continue
        const token = value && typeof value === 'object' ? (value as Record<string, unknown>).oauth_token : undefined
        if (typeof token === 'string' && token.length > 0) {
          log('copilot: found token in %s', path)
          results.push({ providerId: 'github-copilot', source: path, key: token })
          return results
        }
      }
    }

    return results
  },
}

const claudeCodeScanner: DiskScanner = {
  name: 'claude-code',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const base = join(ctx.homedir(), '.claude')
    const files = ['settings.json', 'settings.local.json']

    for (const file of files) {
      const path = join(base, file)
      const json = await readJson(ctx, path)
      if (!json) continue

      for (const field of ['anthropicApiKey', 'anthropic_api_key', 'ANTHROPIC_API_KEY', 'apiKey']) {
        const value = json[field]
        if (typeof value === 'string' && value.length > 0) {
          log('claude-code: found key in %s (%s)', path, field)
          results.push({ providerId: 'anthropic', source: path, key: value })
          return results
        }
      }
    }

    return results
  },
}

const codexCliScanner: DiskScanner = {
  name: 'codex-cli',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const authPath = join(ctx.homedir(), '.codex', 'auth.json')
    const json = await readJson(ctx, authPath)
    if (!json) return results

    const token = json.token ?? json.apiKey
    if (typeof token === 'string' && token.length > 0) {
      log('codex-cli: found token in %s', authPath)
      results.push({ providerId: 'openai', source: authPath, key: token })
    }

    return results
  },
}

const geminiCliScanner: DiskScanner = {
  name: 'gemini-cli',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const geminiHome = ctx.env('GEMINI_CLI_HOME') ?? join(ctx.homedir(), '.gemini')
    const files = ['oauth_creds.json', 'google_accounts.json']

    for (const file of files) {
      const path = join(geminiHome, file)
      const json = await readJson(ctx, path)
      if (!json) continue

      const hasToken =
        'access_token' in json ||
        'refresh_token' in json ||
        (Array.isArray(json.accounts) && (json.accounts as unknown[]).length > 0)
      if (hasToken) {
        log('gemini-cli: found credentials in %s', path)
        results.push({ providerId: 'google', source: path })
        return results
      }
    }

    return results
  },
}

const gcloudAdcScanner: DiskScanner = {
  name: 'gcloud-adc',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const cloudSdkConfig = ctx.env('CLOUDSDK_CONFIG')
    const paths = [
      ctx.env('GOOGLE_APPLICATION_CREDENTIALS'),
      cloudSdkConfig ? join(cloudSdkConfig, 'application_default_credentials.json') : undefined,
      join(configDir(ctx), 'gcloud', 'application_default_credentials.json'),
    ].filter((p): p is string => typeof p === 'string')

    for (const path of paths) {
      const json = await readJson(ctx, path)
      if (!json) continue

      if ('refresh_token' in json || 'type' in json || 'private_key' in json) {
        log('gcloud-adc: found ADC in %s', path)
        results.push({ providerId: 'google-vertex', source: path })
        return results
      }
    }

    return results
  },
}

const awsCredentialsScanner: DiskScanner = {
  name: 'aws-credentials',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const credPath = ctx.env('AWS_SHARED_CREDENTIALS_FILE') ?? join(ctx.homedir(), '.aws', 'credentials')
    const raw = await ctx.readFile(credPath)
    if (!raw) return results

    const profile = ctx.env('AWS_PROFILE') ?? 'default'
    const key = parseIniProfileKey(raw, profile, 'aws_access_key_id')

    if (key) {
      log('aws: found credentials for profile [%s] in %s', profile, credPath)
      results.push({ providerId: 'amazon-bedrock', source: credPath })
    }

    return results
  },
}

const opencodeAuthScanner: DiskScanner = {
  name: 'opencode-auth',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const xdgData = ctx.env('XDG_DATA_HOME')
    const home = ctx.homedir()
    const platform = ctx.platform()

    const paths = [
      xdgData ? join(xdgData, 'opencode', 'auth.json') : undefined,
      platform === 'darwin' ? join(home, 'Library', 'Application Support', 'opencode', 'auth.json') : undefined,
      join(home, '.local', 'share', 'opencode', 'auth.json'),
      join(home, '.config', 'opencode', 'auth.json'),
    ].filter((p): p is string => typeof p === 'string')

    for (const path of paths) {
      const json = await readJson(ctx, path)
      if (!json) continue

      for (const [providerId, entry] of Object.entries(json)) {
        if (!entry || typeof entry !== 'object') continue
        const typed = entry as Record<string, unknown>
        const type = typed.type
        if (type !== 'api' && type !== 'oauth' && type !== 'wellknown') continue

        const key =
          typeof typed.key === 'string' ? typed.key : typeof typed.access === 'string' ? typed.access : undefined
        log('opencode-auth: found %s (%s) in %s', providerId, type, path)
        results.push({ providerId, source: path, key, credentialType: type as DiskScanResult['credentialType'] })
      }

      if (results.length > 0) return results
    }

    return results
  },
}

const vscodeSettingsScanner: DiskScanner = {
  name: 'vscode',
  async scan(ctx) {
    const results: DiskScanResult[] = []
    const home = ctx.homedir()
    const platform = ctx.platform()

    const vscodePaths = [
      platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot', 'hosts.json')
        : undefined,
      join(configDir(ctx), 'Code', 'User', 'globalStorage', 'github.copilot', 'hosts.json'),
    ].filter((p): p is string => typeof p === 'string')

    for (const path of vscodePaths) {
      const json = await readJson(ctx, path)
      if (!json) continue

      for (const [key, value] of Object.entries(json)) {
        if (!key.includes('github.com')) continue
        const token = value && typeof value === 'object' ? (value as Record<string, unknown>).oauth_token : undefined
        if (typeof token === 'string' && token.length > 0) {
          log('vscode: found copilot token in %s', path)
          results.push({ providerId: 'github-copilot', source: path, key: token })
          return results
        }
      }
    }

    return results
  },
}

// ---------------------------------------------------------------------------
// INI parser (minimal, for AWS credentials)
// ---------------------------------------------------------------------------

function parseIniProfileKey(raw: string, profile: string, key: string): string | undefined {
  const lines = raw.split('\n')
  let inProfile = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      const name = trimmed.slice(1, trimmed.indexOf(']')).trim()
      inProfile = name === profile
      continue
    }
    if (inProfile && trimmed.startsWith(key)) {
      const eq = trimmed.indexOf('=')
      if (eq !== -1) return trimmed.slice(eq + 1).trim()
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DEFAULT_SCANNERS: DiskScanner[] = [
  copilotScanner,
  vscodeSettingsScanner,
  claudeCodeScanner,
  codexCliScanner,
  geminiCliScanner,
  gcloudAdcScanner,
  awsCredentialsScanner,
  opencodeAuthScanner,
]

export async function runDiskScanners(scanners: DiskScanner[], ctx?: ScanContext): Promise<DiskScanResult[]> {
  const scanCtx = ctx ?? createNodeScanContext()
  const results: DiskScanResult[] = []

  for (const scanner of scanners) {
    try {
      const found = await scanner.scan(scanCtx)
      results.push(...found)
    } catch (err: unknown) {
      log('scanner %s failed: %s', scanner.name, err instanceof Error ? err.message : String(err))
    }
  }

  return results
}
