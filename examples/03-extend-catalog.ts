import { createAuthStore, createProviderStore } from 'openllmprovider'

const authStore = createAuthStore()
const providerStore = createProviderStore(authStore)

providerStore.extend({
  providers: {
    'my-company-llm': {
      name: 'My Company LLM',
      env: ['MY_LLM_KEY'],
      bundledProvider: '@ai-sdk/openai-compatible',
      baseURL: 'https://llm.internal.company.com/v1',
      headers: { 'X-Custom-Header': 'my-value' },
      models: {
        'company-model-v2': {
          name: 'Company Model V2',
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 128_000, output: 4096 },
        },
      },
    },
  },
})

const model = await providerStore.getLanguageModel('my-company-llm', 'company-model-v2')
console.log('Custom model:', model.modelId)

const providers = await providerStore.listProviders()
console.log(
  'All providers:',
  providers.map((p) => p.id)
)

const models = providerStore.listModels('my-company-llm')
console.log(
  'Models for my-company-llm:',
  models.map((m) => m.modelId)
)
