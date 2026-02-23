import { getLanguageModel } from 'openllmprovider'

const model = await getLanguageModel('openai', 'gpt-4o')
console.log('Model created:', model.modelId)
