import { createAuthStore, createProviderStore } from '../src/index.js'
import type { ModelDefinition } from '../src/index.js'

function printModelInfo(title: string, providerId: string, model: ModelDefinition) {
  console.log(title, {
    providerId,
    modelId: model.modelId,
    name: model.name,
    contextWindow: model.limit.context,
    maxOutputTokens: model.limit.output,
    inputModalities: model.modalities.input,
    outputModalities: model.modalities.output,
    provenance: model.provenance,
  })
}

const authProviderId = 'openai'
const authModelId = process.argv[2]?.trim() || 'gpt-4o-mini'
const noAuthProviderId = 'anthropic'
const noAuthModelId = process.argv[3]?.trim() || 'claude-3-5-haiku-latest'

const authStore = createAuthStore({
  data: {
    [authProviderId]: { type: 'api', key: 'sk-demo-openai-key' },
  },
})

const providerStore = createProviderStore(authStore)

const authModel = await providerStore.getModel(authProviderId, authModelId)
if (!authModel) {
  throw new Error(`Auth scenario model not found: ${authProviderId}/${authModelId}`)
}
printModelInfo('Scenario 1 - with auth (auto-enriched):', authProviderId, authModel)

const noAuthModelFiltered = await providerStore.getModel(noAuthProviderId, noAuthModelId)
console.log('Scenario 2 - without auth (default filter):', noAuthModelFiltered ? 'found' : 'not found')

const noAuthModel = await providerStore.getModel(noAuthProviderId, noAuthModelId, { includeUnavailable: true })
if (!noAuthModel) {
  throw new Error(`No-auth scenario model not found with includeUnavailable=true: ${noAuthProviderId}/${noAuthModelId}`)
}
printModelInfo('Scenario 2 - without auth (auto-enriched + includeUnavailable):', noAuthProviderId, noAuthModel)

console.log('\nUsage: bunx tsx examples/09-model-info.ts [openaiModelId] [anthropicModelId]')
