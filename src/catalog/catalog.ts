import { createLogger } from '../logger.js'
import type { ModelDefinition } from '../types/model.js'
import { mapModelsDevProvider, mapModelsDevProviderMetadata } from './mapper.js'
import { mergeCatalogData, mergeModelDefinitions } from './merger.js'

const DEFAULT_REMOTE_URL = 'https://models.dev/api/v1/providers'
const DEFAULT_TIMEOUT_MS = 10_000

const log = createLogger('catalog')

type CatalogDataSource = Record<string, unknown>
type ProviderModelMap = Map<string, Map<string, ModelDefinition>>
type FetchLike = (
  url: string,
  init?: { signal?: unknown }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface CatalogProvider {
  id: string
  name: string
  env?: string[]
  api?: string
  doc?: string
  bundledProvider?: string
  baseURL?: string
  headers?: Record<string, string>
  options?: Record<string, unknown>
}

export interface ExtendModelConfig {
  name?: string
  modalities?: {
    input: Array<'text' | 'image' | 'audio' | 'video' | 'pdf'>
    output: Array<'text' | 'image' | 'audio'>
  }
  limit?: { context: number; output: number }
}

export interface ExtendProviderConfig {
  name: string
  env?: string[]
  bundledProvider?: string
  baseURL?: string
  headers?: Record<string, string>
  options?: Record<string, unknown>
  models?: Record<string, ExtendModelConfig>
}

export interface ExtendConfig {
  providers?: Record<string, ExtendProviderConfig>
}

export interface CatalogOptions {
  snapshot?: Record<string, unknown>
  remote?: {
    url?: string
    timeoutMs?: number
    fetch?: FetchLike
  }
}

export interface RefreshResult {
  success: boolean
  updatedProviders: string[]
  newModels: number
  error?: Error
}

export class Catalog {
  private readonly remoteOptions: {
    readonly url: string
    readonly timeoutMs: number
    readonly fetch?: FetchLike
  }

  private readonly snapshotData: CatalogDataSource
  private remoteData: CatalogDataSource = {}
  private readonly providers = new Map<string, CatalogProvider>()
  private modelsByProvider: ProviderModelMap = new Map()
  private refreshInFlight: Promise<RefreshResult> | null = null
  private readonly extendedProviders = new Map<string, CatalogProvider>()
  private readonly extendedModels = new Map<string, Map<string, Partial<ModelDefinition>>>()

  constructor(options: CatalogOptions = {}) {
    this.snapshotData = options.snapshot ?? {}
    this.remoteOptions = {
      url: options.remote?.url ?? DEFAULT_REMOTE_URL,
      timeoutMs: options.remote?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetch: options.remote?.fetch,
    }
    this.applyProviderMetadata(this.snapshotData, {})
    log('initialized with %d providers from snapshot', this.providers.size)
  }

  getProvider(id: string): CatalogProvider | undefined {
    return this.providers.get(id)
  }

  listProviders(): CatalogProvider[] {
    return [...this.providers.values()]
  }

  getModel(providerId: string, modelId: string): ModelDefinition | undefined {
    this.ensureProviderModelsLoaded(providerId)
    return this.modelsByProvider.get(providerId)?.get(modelId)
  }

  listModels(providerId?: string): ModelDefinition[] {
    if (providerId !== undefined) {
      this.ensureProviderModelsLoaded(providerId)
      return [...(this.modelsByProvider.get(providerId)?.values() ?? [])]
    }

    const results: ModelDefinition[] = []
    for (const pid of this.providers.keys()) {
      this.ensureProviderModelsLoaded(pid)
      const models = this.modelsByProvider.get(pid)
      if (models) {
        results.push(...models.values())
      }
    }
    return results
  }

  enrichModel(providerId: string, modelId: string, partial: Partial<ModelDefinition>): ModelDefinition {
    const catalogModel = this.getModel(providerId, modelId)
    const partialWithId = { ...partial, modelId }
    if (!catalogModel) {
      return partialWithId as ModelDefinition
    }
    return mergeModelDefinitions(catalogModel, partialWithId)
  }

  extend(config: ExtendConfig): void {
    if (!config.providers) return

    for (const [providerId, providerConfig] of Object.entries(config.providers)) {      
      const existingProvider = this.providers.get(providerId)
      const provider: CatalogProvider = {
        id: providerId,
        name: providerConfig.name,
        ...(providerConfig.env !== undefined ? { env: providerConfig.env } : {}),
        ...(existingProvider?.api !== undefined ? { api: existingProvider.api } : {}),
        ...(existingProvider?.doc !== undefined ? { doc: existingProvider.doc } : {}),
        ...(providerConfig.bundledProvider !== undefined ? { bundledProvider: providerConfig.bundledProvider } : {}),
        ...(providerConfig.baseURL !== undefined ? { baseURL: providerConfig.baseURL } : {}),
        ...(providerConfig.headers !== undefined ? { headers: providerConfig.headers } : {}),
        ...(providerConfig.options !== undefined ? { options: providerConfig.options } : {}),
      }

      this.extendedProviders.set(providerId, provider)
      this.providers.set(providerId, provider)

      if (providerConfig.models) {
        const modelOverrides = this.extendedModels.get(providerId) ?? new Map<string, Partial<ModelDefinition>>()

        for (const [modelId, modelConfig] of Object.entries(providerConfig.models)) {
          const partial: Partial<ModelDefinition> = { modelId }
          if (modelConfig.name !== undefined) partial.name = modelConfig.name
          if (modelConfig.modalities !== undefined) partial.modalities = modelConfig.modalities
          if (modelConfig.limit !== undefined) partial.limit = modelConfig.limit
          modelOverrides.set(modelId, partial)
        }

        this.extendedModels.set(providerId, modelOverrides)
      }

      this.modelsByProvider.delete(providerId)
    }
  }

  refresh(): Promise<RefreshResult> {
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    const task = this.refreshInternal().finally(() => {
      this.refreshInFlight = null
    })

    this.refreshInFlight = task
    return task
  }

  private async refreshInternal(): Promise<RefreshResult> {
    try {
      log('refresh: fetching from %s', this.remoteOptions.url)
      const remoteData = await this.fetchRemoteData()
      this.remoteData = remoteData
      const { updatedProviders } = this.applyProviderMetadata(this.snapshotData, this.remoteData)
      this.modelsByProvider.clear()
      log('refresh: updated %d providers', updatedProviders.length)
      return { success: true, updatedProviders, newModels: 0 }
    } catch (error) {
      log('refresh: failed — %s', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        updatedProviders: [],
        newModels: 0,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private async fetchRemoteData(): Promise<CatalogDataSource> {
    const fetchFn = this.remoteOptions.fetch ?? this.resolveGlobalFetch()
    if (!fetchFn) throw new Error('No fetch implementation available')

    const response = await fetchFn(this.remoteOptions.url)
    if (!response.ok) throw new Error(`Failed to fetch remote catalog: HTTP ${response.status}`)

    const payload = await response.json()
    if (payload && typeof payload === 'object') return payload as CatalogDataSource
    throw new Error('Invalid remote catalog payload')
  }

  private resolveGlobalFetch(): FetchLike | undefined {
    const maybeFetch = (globalThis as Record<string, unknown>).fetch
    return typeof maybeFetch === 'function' ? (maybeFetch as FetchLike) : undefined
  }

  private applyProviderMetadata(
    snapshotRaw: CatalogDataSource,
    remoteRaw: CatalogDataSource
  ): { updatedProviders: string[] } {
    const snapshotProviders = this.mapProviderMetadata(snapshotRaw)
    const remoteProviders = this.mapProviderMetadata(remoteRaw)
    const allProviderIds = new Set<string>([...snapshotProviders.keys(), ...remoteProviders.keys()])

    this.providers.clear()
    for (const providerId of allProviderIds) {
      const provider = remoteProviders.get(providerId) ?? snapshotProviders.get(providerId)
      if (provider) this.providers.set(providerId, provider)
    }

    for (const [providerId, provider] of this.extendedProviders.entries()) {
      this.providers.set(providerId, provider)
    }

    return { updatedProviders: [...remoteProviders.keys()] }
  }

  private mapProviderMetadata(data: CatalogDataSource): Map<string, CatalogProvider> {
    const result = new Map<string, CatalogProvider>()
    for (const [providerId, rawProvider] of Object.entries(data)) {
      if (providerId.startsWith('_')) continue
      result.set(providerId, mapModelsDevProviderMetadata(providerId, rawProvider))
    }
    return result
  }

  private providerRaw(data: CatalogDataSource, providerId: string): unknown {
    const value = data[providerId]
    return value && typeof value === 'object' ? value : undefined
  }

  private mapProviderModelsFromRaw(
    providerId: string,
    raw: unknown,
    provenance: 'snapshot' | 'remote'
  ): Map<string, ModelDefinition> {
    if (!raw || typeof raw !== 'object') return new Map<string, ModelDefinition>()
    const mapped = mapModelsDevProvider(providerId, raw, provenance)
    const byId = new Map<string, ModelDefinition>()
    for (const model of mapped.models) {
      byId.set(model.modelId, model)
    }
    return byId
  }

  private ensureProviderModelsLoaded(providerId: string): void {
    if (this.modelsByProvider.has(providerId)) return

    const snapshotModels = this.mapProviderModelsFromRaw(
      providerId,
      this.providerRaw(this.snapshotData, providerId),
      'snapshot'
    )
    const remoteModels = this.mapProviderModelsFromRaw(
      providerId,
      this.providerRaw(this.remoteData, providerId),
      'remote'
    )
    const extendedOverrides = this.extendedModels.get(providerId) ?? new Map<string, Partial<ModelDefinition>>()

    const merged = mergeCatalogData(snapshotModels, remoteModels, extendedOverrides)

    for (const [modelId, partial] of extendedOverrides.entries()) {
      if (!merged.has(modelId)) {
        const base: ModelDefinition = {
          modelId,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 0, output: 0 },
          provenance: 'user-override',
        }
        merged.set(modelId, mergeModelDefinitions(base, partial))
      }
    }

    this.modelsByProvider.set(providerId, merged)
  }
}
