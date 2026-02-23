import { anthropicPlugin, createAuthStore } from '../src/index.js'

async function loginAndSaveClaudeProMax() {
  const authStore = createAuthStore()
  const authMethod = anthropicPlugin.methods.find((m) => m.type === 'oauth')
  if (!authMethod) {
    throw new Error('Claude Pro/Max OAuth method is not available')
  }

  const credential = await authMethod.handler()
  await authStore.set('anthropic', credential)

  const saved = await authStore.get('anthropic')
  console.log('Saved Anthropic credential:', {
    type: saved?.type,
    hasAccessToken: typeof saved?.key === 'string' && saved.key.length > 0,
    hasRefreshToken: typeof saved?.refresh === 'string' && saved.refresh.length > 0,
    expires: saved?.expires,
  })
}

await loginAndSaveClaudeProMax()
