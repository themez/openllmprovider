/**
 * Create Provider Instance
 *
 * Use createProvider() for more control — reuse the same provider
 * instance across multiple model requests, inspect resolved state.
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx examples/02-create-provider.ts
 */
import { createProvider } from 'openllmprovider'

const provider = createProvider()

// Get a model
const sonnet = await provider.getLanguageModel('anthropic', 'claude-sonnet-4-20250514')
console.log('Sonnet:', sonnet.modelId)

// Same provider instance, different model
const haiku = await provider.getLanguageModel('anthropic', 'claude-haiku-4-20250514')
console.log('Haiku:', haiku.modelId)

// Inspect resolved provider state (credentials, options, sources)
const state = await provider.getState()
for (const [id, s] of Object.entries(state)) {
  if (s.source !== 'none') {
    console.log(`  ${id}: source=${s.source}, hasKey=${s.key !== undefined}`)
  }
}
