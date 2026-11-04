import { defineConfig } from 'vitest/config'

// 시험의 층 (docs/design.md 6절).
// unit: core의 [단위]. 외부 없이 돈다.
// adapters: 실제 git, 파일, 프로세스를 쓰는 [어댑터].
// flow: engine + adapters + 임시 git 레포의 [흐름].
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'adapters',
          include: ['test/adapters/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'flow',
          include: ['test/flow/**/*.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
