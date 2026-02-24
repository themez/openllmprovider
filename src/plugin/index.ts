import { createLogger } from '../logger.js'
import type { AuthCredential, AuthHook, ProviderInfo } from '../types/plugin.js'

const log = createLogger('plugin')
const plugins: Map<string, AuthHook> = new Map()

export function registerPlugin(plugin: AuthHook): void {
  log('registering plugin for provider: %s', plugin.provider)
  plugins.set(plugin.provider, plugin)
}

export function getPlugins(): AuthHook[] {
  return [...plugins.values()]
}

export function getPluginForProvider(providerId: string): AuthHook | undefined {
  return plugins.get(providerId)
}

export async function loadPluginOptions(
  providerId: string,
  getAuth: () => Promise<AuthCredential>,
  providerInfo: ProviderInfo,
  setAuth: (credential: AuthCredential) => Promise<void>,
): Promise<Record<string, unknown> | undefined> {
  const plugin = plugins.get(providerId)
  if (!plugin) return undefined
  log('loading plugin options for provider: %s', providerId)
  return plugin.loader(getAuth, providerInfo, setAuth)
}
