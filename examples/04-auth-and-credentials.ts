import { createAuthStore, createProviderStore } from 'openllmprovider'

const authStore = createAuthStore({
  data: {
    anthropic: { type: 'api', key: 'sk-ant-test-key' },
  },
})

const cred = await authStore.get('anthropic')
console.log('Stored credential:', cred)

const discovered = await authStore.discover()
for (const info of discovered) {
  console.log(`Discovered: ${info.providerId} via ${info.source}`)
}

const providerStore = createProviderStore(authStore, {
  userConfig: {
    openai: { apiKey: { type: 'env', name: 'OPENAI_API_KEY' } },
    anthropic: { apiKey: 'sk-ant-hardcoded-key' },
    groq: {
      apiKey: { type: 'env', name: 'GROQ_API_KEY' },
      baseURL: 'https://api.groq.com/openai/v1',
    },
  },
})

const providers = await providerStore.listProviders()
for (const p of providers) {
  console.log(`  ${p.id}: ${p.name}`)
}
