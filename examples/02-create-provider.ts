import { createAuthStore, createProviderStore } from 'openllmprovider'

const authStore = createAuthStore()
const providerStore = createProviderStore(authStore)

const sonnet = await providerStore.getLanguageModel('anthropic', 'claude-sonnet-4-20250514')
console.log('Sonnet:', sonnet.modelId)

const haiku = await providerStore.getLanguageModel('anthropic', 'claude-haiku-4-20250514')
console.log('Haiku:', haiku.modelId)

const providers = await providerStore.listProviders()
for (const p of providers) {
  console.log(`  ${p.id}: ${p.name}`)
}
