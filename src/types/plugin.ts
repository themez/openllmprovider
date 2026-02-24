export interface ProviderInfo {
  id: string
  name?: string
}

/**
 * Unified credential for all auth types.
 *
 * API key auth (type: 'api'):
 *   - key: the API key string (e.g. sk-ant-xxx for Anthropic, sk-xxx for OpenAI)
 *
 * OAuth auth (type: 'oauth'):
 *   - key:     short-lived access_token for API calls
 *   - refresh: long-lived refresh_token used to obtain a new access_token when expired
 *   - expires: absolute timestamp (ms) when the access_token expires
 *
 * Well-known auth (type: 'wellknown'):
 *   - key: credential discovered from well-known config file locations
 */
export interface AuthCredential {
  type: 'api' | 'oauth' | 'wellknown'
  /** API key (type 'api') or OAuth access_token (type 'oauth') */
  key?: string
  /** OAuth refresh_token — only present when type is 'oauth' */
  refresh?: string
  /** Absolute timestamp (ms) when the access_token expires — only present when type is 'oauth' */
  expires?: number
  baseURL?: string
  apiHost?: string
  host?: string
  location?: string
  [key: string]: unknown
}

export interface AuthMethod {
  type: string
  label: string
  handler(): Promise<AuthCredential>
}

export interface AuthHook {
  provider: string
  loader(
    getAuth: () => Promise<AuthCredential>,
    provider: ProviderInfo,
    setAuth: (credential: AuthCredential) => Promise<void>,
  ): Promise<Record<string, unknown>>
  methods: AuthMethod[]
}
