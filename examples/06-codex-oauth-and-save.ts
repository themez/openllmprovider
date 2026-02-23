import { codexPlugin, createAuthStore, createProviderStore } from '../src/index.js'

async function codexOauthLoginAndSave() {
  const authStore = createAuthStore()

  const deviceFlowMethod = codexPlugin.methods.find((m) => m.type === 'device-flow')
  if (!deviceFlowMethod) {
    throw new Error('Codex device flow method is not available')
  }

  const credential = await deviceFlowMethod.handler()
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

await codexOauthLoginAndSave()
await codexOauthUsage()
