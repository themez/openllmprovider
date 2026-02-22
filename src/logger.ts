import createDebug from 'debug'

export function createLogger(namespace: string) {
  return createDebug(`openllmprovider:${namespace}`)
}

export const log = createDebug('openllmprovider')
