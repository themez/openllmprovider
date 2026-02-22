import type { ModelDefinition } from '../types/model.js'

type NestedObject = Record<string, unknown>

const FIELD_LEVEL_MERGE_KEYS: ReadonlySet<string> = new Set(['limit', 'cost'])
const REPLACE_KEYS: ReadonlySet<string> = new Set(['modalities'])

function mergeNestedObject(
  base: NestedObject | undefined,
  overlay: NestedObject | undefined
): NestedObject | undefined {
  if (!overlay) return base ? { ...base } : undefined
  if (!base) return { ...overlay }
  const result = { ...base }
  for (const key of Object.keys(overlay)) {
    if (overlay[key] !== undefined) {
      result[key] = overlay[key]
    }
  }
  return result
}

export function mergeModelDefinitions(base: ModelDefinition, overlay: Partial<ModelDefinition>): ModelDefinition {
  const result = { ...base }

  for (const key of Object.keys(overlay) as Array<keyof ModelDefinition>) {
    if (key === 'modelId') continue

    const overlayValue = overlay[key]
    if (overlayValue === undefined) continue

    if (FIELD_LEVEL_MERGE_KEYS.has(key)) {
      const merged = mergeNestedObject(base[key] as NestedObject | undefined, overlayValue as NestedObject)
      if (merged !== undefined) {
        ;(result as Record<string, unknown>)[key] = merged
      }
      continue
    }

    if (REPLACE_KEYS.has(key)) {
      ;(result as Record<string, unknown>)[key] = overlayValue
      continue
    }
    ;(result as Record<string, unknown>)[key] = overlayValue
  }

  return result
}

export function mergeCatalogData(
  snapshot: Map<string, ModelDefinition>,
  remote: Map<string, ModelDefinition>,
  overrides: Map<string, Partial<ModelDefinition>>
): Map<string, ModelDefinition> {
  const allModelIds = new Set([...snapshot.keys(), ...remote.keys()])
  const result = new Map<string, ModelDefinition>()

  for (const modelId of allModelIds) {
    const snap = snapshot.get(modelId)
    const rem = remote.get(modelId)
    const override = overrides.get(modelId)

    const inSnapshot = snap !== undefined
    const inRemote = rem !== undefined
    const hasOverride = override !== undefined

    let merged: ModelDefinition

    if (inSnapshot && inRemote) {
      merged = mergeModelDefinitions(snap, rem)
    } else if (inRemote) {
      merged = { ...rem }
    } else if (snap) {
      merged = { ...snap }
    } else {
      continue
    }

    if (hasOverride) {
      merged = mergeModelDefinitions(merged, override)
    }

    if (hasOverride) {
      merged.provenance = 'user-override'
    } else if (inRemote) {
      merged.provenance = 'remote'
    } else {
      merged.provenance = 'snapshot'
    }

    if (inSnapshot && !inRemote) {
      merged.status = 'deprecated'
    }

    result.set(modelId, merged)
  }

  return result
}
