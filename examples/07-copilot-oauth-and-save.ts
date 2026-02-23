import { copilotPlugin, createAuthStore, createProviderStore } from '../src/index.js'

async function loginAndSaveCopilot() {
  const authStore = createAuthStore()
  const mode = (process.env.COPILOT_AUTH_MODE ?? 'github').toLowerCase()
  const authMethod =
    mode === 'enterprise'
      ? copilotPlugin.methods.find((m) => m.type === 'device-flow')
      : copilotPlugin.methods.find((m) => m.type === 'oauth')

  if (!authMethod) {
    throw new Error(`Copilot auth method unavailable for mode=${mode}`)
  }

  const credential = await authMethod.handler()
  await authStore.set('github-copilot', credential)

  const saved = await authStore.get('github-copilot')
  console.log('Saved Copilot credential:', {
    type: saved?.type,
    hasToken: typeof saved?.refresh === 'string' || typeof saved?.key === 'string',
    enterpriseUrl: typeof saved?.enterpriseUrl === 'string' ? saved.enterpriseUrl : undefined,
  })
}

async function testCopilot() {
  const authStore = createAuthStore()
  const providerStore = createProviderStore(authStore)

  const model = await providerStore.getLanguageModel('github-copilot', 'claude-haiku-4.5')
  const result = await model.doGenerate({
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Write a haiku about coding.' }],
      },
    ],
  })

  console.log(result.content)
}

// Uncomment to run the login flow and save the credential
// await loginAndSaveCopilot()
await testCopilot()


