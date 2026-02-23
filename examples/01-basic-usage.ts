/**
 * Basic Usage
 *
 * The simplest way to get a language model.
 * Just set an env var (e.g. OPENAI_API_KEY) and call getLanguageModel().
 *
 * Run: OPENAI_API_KEY=sk-xxx npx tsx examples/01-basic-usage.ts
 */
import { getLanguageModel } from 'openllmprovider'

// One-liner: provider ID + model ID → LanguageModelV3
const model = await getLanguageModel('openai', 'gpt-4o')

console.log('Model created:', model.modelId)

// Use with AI SDK:
// import { generateText } from 'ai'
// const result = await generateText({ model, prompt: 'Hello!' })
// console.log(result.text)
