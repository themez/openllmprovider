/**
 * Auth Store & Credential Discovery
 *
 * Demonstrates the credential resolution chain:
 *   env vars → auth.json → user config
 *
 * The auth store persists credentials to ~/.local/share/openllmprovider/auth.json
 * (or XDG_DATA_HOME). You can also use in-memory data for testing.
 *
 * Run: OPENAI_API_KEY=sk-xxx npx tsx examples/04-auth-and-credentials.ts
 */
import { createAuthStore, createCatalog, createProvider, discoverCredentials } from 'openllmprovider'

// --- In-memory auth store (for testing) ---
const authStore = createAuthStore({
  data: {
    anthropic: { type: 'api', key: 'sk-ant-test-key' },
  },
})

// Read back
const cred = await authStore.get('anthropic')
console.log('Stored credential:', cred)

// --- Credential discovery ---
const catalog = createCatalog()
const discovered = await discoverCredentials(catalog, authStore)

for (const [providerId, info] of Object.entries(discovered)) {
  console.log(`Discovered: ${providerId} via ${info.source}`)
}

// --- User config with SecretRef ---
// Override provider credentials via config (supports env/plain/storage refs)
const provider = createProvider({
  catalog,
  authStore,
  userConfig: {
    openai: {
      apiKey: { type: 'env', name: 'OPENAI_API_KEY' },
    },
    anthropic: {
      apiKey: 'sk-ant-hardcoded-key', // string shorthand for { type: 'plain', value: '...' }
    },
    groq: {
      apiKey: { type: 'env', name: 'GROQ_API_KEY' },
      baseURL: 'https://api.groq.com/openai/v1',
    },
  },
})

const state = await provider.getState()
for (const [id, s] of Object.entries(state)) {
  if (s.source !== 'none') {
    console.log(`  ${id}: source=${s.source}`)
  }
}
