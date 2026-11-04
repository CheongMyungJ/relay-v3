// preload가 내놓는 window.relay (src/preload/index.ts, src/shared/api.ts의 RelayApi)
import type { RelayApi } from '../../shared/api.ts'

declare global {
  interface Window {
    relay: RelayApi
  }
}

export {}
