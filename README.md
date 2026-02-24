# openllmprovider

Control plane for AI model providers. Unified credential management, automatic auth discovery, and OAuth token lifecycle handling for [Vercel AI SDK](https://sdk.vercel.ai/) providers.

## Install

```bash
npm install openllmprovider
```

AI SDK provider packages are optional peer dependencies — install only what you need:

```bash
npm install @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
```

## Quick Start

```typescript
import { createAuthStore, createProviderStore } from 'openllmprovider'

const authStore = createAuthStore()
const providerStore = createProviderStore(authStore)

// Auto-discovers credentials from env vars, config files, etc.
await authStore.discover()

const model = await providerStore.getLanguageModel('anthropic', 'claude-sonnet-4-6')
```

## Features

- **Multi-provider support** — Anthropic, OpenAI, Google, Azure, Groq, Mistral, xAI, OpenRouter, Amazon Bedrock, GitHub Copilot
- **Auto-discovery** — Finds credentials from environment variables, opencode config, VS Code settings, AWS profiles, and more
- **OAuth flows** — Built-in OAuth for Claude Pro/Max, ChatGPT Pro/Plus (Codex), Google Gemini, and GitHub Copilot
- **Token lifecycle** — Automatic refresh of expired OAuth tokens with persistence back to the auth store
- **Plugin system** — Extensible auth hooks for custom providers

## Auth Store

```typescript
import { createAuthStore } from 'openllmprovider'

// From explicit data
const authStore = createAuthStore({
  data: {
    anthropic: { type: 'api', key: 'sk-ant-xxx' },
    openai: { type: 'api', key: 'sk-xxx' },
  },
})

// Or auto-discover from env/disk
const authStore = createAuthStore()
await authStore.discover({ persist: true })
```

### Credential Types

| Type | Fields | Description |
|------|--------|-------------|
| `api` | `key` | Direct API key (e.g. `sk-ant-api03-xxx`) |
| `oauth` | `key`, `refresh`, `expires` | OAuth access token + refresh token |
| `wellknown` | `key` | Discovered from well-known config locations |

## OAuth Flows

Built-in plugins handle the full OAuth lifecycle:

```typescript
import { anthropicPlugin, codexPlugin, googlePlugin } from 'openllmprovider'

// Run the interactive OAuth flow
const method = anthropicPlugin.methods.find(m => m.type === 'oauth')
const credential = await method.handler()

// Save to auth store
await authStore.set('anthropic', credential)
```

### Refresh Token Rotation

**Anthropic (and some other providers) use refresh token rotation** — each time a token is refreshed, the server issues a new refresh token and invalidates the old one.

This has an important consequence: **OAuth credentials cannot be shared across applications**. If two applications (e.g. opencode and your app) hold the same OAuth credential, whichever refreshes first will invalidate the other's refresh token, causing `400 Bad Request` errors on subsequent refresh attempts.

Each application must:
1. Perform its own OAuth authorization flow
2. Store and manage its own credentials independently
3. Never copy OAuth credentials from another application's config

> API key credentials (`type: 'api'`) are not affected — they can be safely shared across applications.

## Plugin System

```typescript
import { registerPlugin } from 'openllmprovider'
import type { AuthHook } from 'openllmprovider'

const myPlugin: AuthHook = {
  provider: 'my-provider',
  async loader(getAuth, provider, setAuth) {
    const auth = await getAuth()
    // setAuth persists updated credentials back to the auth store
    return { apiKey: auth.key }
  },
  methods: [
    {
      type: 'api-key',
      label: 'API Key',
      async handler() {
        return { type: 'api', key: 'user-provided-key' }
      },
    },
  ],
}

registerPlugin(myPlugin)
```

## License

MIT
