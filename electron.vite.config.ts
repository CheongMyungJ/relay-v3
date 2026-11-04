// 앱 빌드 (docs/m2-modules.md 0절). main 입력은 둘: 앱(index)과 MCP 브리지(mcp-bridge, ELECTRON_RUN_AS_NODE로 돈다).
// 상대 import의 .ts는 Vite가 푼다. 경로는 npm 스크립트가 도는 레포 루트 기준이다.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = (p: string) => resolve(import.meta.dirname, p)

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: root('src/main/index.ts'),
          'mcp-bridge': root('src/main/mcp-bridge.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // 샌드박스 preload는 CommonJS여야 한다(package.json의 type은 module): out/preload/index.cjs
      rollupOptions: {
        input: { index: root('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: root('src/renderer'),
    build: { rollupOptions: { input: root('src/renderer/index.html') } },
    plugins: [react()],
  },
})
