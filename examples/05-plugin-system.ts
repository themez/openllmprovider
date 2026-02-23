/**
 * Plugin System
 *
 * Plugins provide custom auth flows (e.g. OAuth device flow)
 * and inject SDK options (e.g. custom fetch with auth headers).
 *
 * Built-in plugins: copilotPlugin, codexPlugin
 *
 * Run: npx tsx examples/05-plugin-system.ts
 */
import { codexPlugin, copilotPlugin, getPluginForProvider, getPlugins, registerPlugin } from 'openllmprovider'

// Register built-in plugins
registerPlugin(copilotPlugin)
registerPlugin(codexPlugin)

// List all registered plugins
const plugins = getPlugins()
console.log(
  'Registered plugins:',
  plugins.map((p) => p.provider)
)

// Look up a specific plugin
const copilot = getPluginForProvider('github-copilot')
if (copilot) {
  console.log('Copilot plugin found')
  console.log(
    '  Auth methods:',
    copilot.methods.map((m) => m.label)
  )
}

// --- Custom plugin example ---
import type { AuthHook } from 'openllmprovider'

const myPlugin: AuthHook = {
  provider: 'my-custom-provider',

  async loader(getAuth, _provider) {
    const auth = await getAuth()
    return {
      apiKey: auth.key,
      baseURL: 'https://api.custom.com/v1',
    }
  },

  methods: [
    {
      type: 'api-key',
      label: 'API Key',
      async handler() {
        // In a real app, prompt the user for their API key
        return { type: 'api', key: 'user-provided-key' }
      },
    },
  ],
}

registerPlugin(myPlugin)
console.log(
  'After custom plugin:',
  getPlugins().map((p) => p.provider)
)
