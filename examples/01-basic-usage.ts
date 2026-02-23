import { createAuthStore, createProviderStore } from '../src/index.js'

const apiHost = process.env.OPENAI_API_HOST?.trim()
const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY before running this example.')
}

const authStore = createAuthStore({
  data: {
    openai: {
      type: 'api',
      key: apiKey,
      ...(apiHost ? { apiHost } : {}),
    },
  },
})

const providerStore = createProviderStore(authStore)
const model = await providerStore.getLanguageModel('openai', 'gpt-5-mini')
console.log('Model created:', {
  provider: 'openai',
  modelId: model.modelId,
  ...(apiHost ? { apiHost } : {}),
})

const result = await model.doGenerate({
  prompt: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Write a haiku about the ocean.',
        },
      ],
    },
  ],
})

console.log('Generation result:', result.content)
