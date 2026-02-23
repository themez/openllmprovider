import { codexPlugin, copilotPlugin, getPluginForProvider, getPlugins, registerPlugin } from 'openllmprovider'
import type { AuthHook } from 'openllmprovider'

registerPlugin(copilotPlugin)
registerPlugin(codexPlugin)

const plugins = getPlugins()
console.log(
  'Registered plugins:',
  plugins.map((p) => p.provider)
)

const copilot = getPluginForProvider('github-copilot')
if (copilot) {
  console.log('Copilot plugin found')
  console.log(
    '  Auth methods:',
    copilot.methods.map((m) => m.label)
  )
}

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
