/**
 * Extend Catalog
 *
 * Use catalog.extend() to register custom providers that map to
 * one of the 11 bundled AI SDK implementations.
 *
 * Useful for self-hosted or enterprise endpoints that use
 * an OpenAI-compatible API.
 *
 * Run: MY_LLM_KEY=xxx npx tsx examples/03-extend-catalog.ts
 */
import { createCatalog, createProvider } from 'openllmprovider'

const catalog = createCatalog()

// Register a custom provider backed by @ai-sdk/openai-compatible
catalog.extend({
  providers: {
    'my-company-llm': {
      name: 'My Company LLM',
      env: ['MY_LLM_KEY'],
      bundledProvider: '@ai-sdk/openai-compatible',
      baseURL: 'https://llm.internal.company.com/v1',
      headers: {
        'X-Custom-Header': 'my-value',
      },
      models: {
        'company-model-v2': {
          name: 'Company Model V2',
          modalities: {
            input: ['text', 'image'],
            output: ['text'],
          },
          limit: { context: 128_000, output: 4096 },
        },
      },
    },
  },
})

// Use it like any built-in provider
const provider = createProvider({ catalog })
const model = await provider.getLanguageModel('my-company-llm', 'company-model-v2')
console.log('Custom model:', model.modelId)

// You can also list what's registered
const providers = catalog.listProviders()
console.log(
  'All providers:',
  providers.map((p) => p.id)
)

const models = catalog.listModels('my-company-llm')
console.log(
  'Models for my-company-llm:',
  models.map((m) => m.modelId)
)
