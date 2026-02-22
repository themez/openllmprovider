export interface ProviderInfo {
  id: string
  name?: string
}

export interface AuthCredential {
  type: 'api' | 'oauth' | 'wellknown'
  key?: string
  refresh?: string
  access?: string
  expires?: number
  [key: string]: unknown
}

export interface AuthMethod {
  type: string
  label: string
  handler(): Promise<AuthCredential>
}

export interface AuthHook {
  provider: string
  loader(getAuth: () => Promise<AuthCredential>, provider: ProviderInfo): Promise<Record<string, unknown>>
  methods: AuthMethod[]
}
