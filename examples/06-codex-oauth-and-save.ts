import { codexPlugin, createAuthStore, createProviderStore } from '../src/index.js'

async function codexOauthLoginAndSave() {
  const authStore = createAuthStore()

  const mode = (process.env.CODEX_AUTH_MODE ?? 'browser').toLowerCase()
  const authMethod =
    mode === 'headless'
      ? codexPlugin.methods.find((m) => m.type === 'device-flow')
      : codexPlugin.methods.find((m) => m.type === 'oauth')

  if (!authMethod) {
    throw new Error(`Codex auth method is not available for mode=${mode}`)
  }

  const credential = await authMethod.handler()
  await authStore.set('openai', credential)

  const saved = await authStore.get('openai')
  console.log('Saved Codex OAuth credential:', {
    type: saved?.type,
    hasAccessToken: typeof saved?.key === 'string' && saved.key.length > 0,
    hasRefreshToken: typeof saved?.refresh === 'string' && saved.refresh.length > 0,
    expires: saved?.expires,
  })
}

async function codexOauthUsage() {
  const authStore = createAuthStore()
  const providerStore = createProviderStore(authStore)

  const model = await providerStore.getLanguageModel('openai', 'gpt-5.1-codex-mini')
  const result = await model.doGenerate({
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Write a short haiku about coding.' }],
      },
    ],
  })

  console.log(result.content)
}

// await codexOauthLoginAndSave()
await codexOauthUsage()
