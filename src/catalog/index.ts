import type { CatalogOptions } from './catalog.js'
import { Catalog } from './catalog.js'

export type {
  CatalogOptions,
  CatalogProvider,
  ExtendConfig,
  ExtendModelConfig,
  ExtendProviderConfig,
  RefreshResult,
} from './catalog.js'

export { Catalog }

export function createCatalog(options: CatalogOptions = {}): Catalog {
  return new Catalog(options)
}
