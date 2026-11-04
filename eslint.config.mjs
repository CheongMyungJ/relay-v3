import { builtinModules } from 'node:module'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// 층 규칙 (docs/design.md 5절, docs/m2-modules.md 0절): core ← adapters ← engine ← cli, 그 위에 main.
// renderer는 shared와 'import type'만. 'electron'은 main의 index.ts·ipc.ts와 preload에서만.
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
const electron = ['electron', 'electron/*']
const appLayers = ['**/main/**', '**/preload/**', '**/renderer/**']

export default tseslint.config(
  { ignores: ['node_modules/', 'out/', '.relay-out/', 'test-results/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins,
          patterns: [...electron, '**/adapters/**', '**/engine/**', '**/cli/**', ...appLayers],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...electron, '**/engine/**', '**/cli/**', ...appLayers] },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...electron, '**/cli/**', ...appLayers] }],
    },
  },
  {
    // main은 Node에서도 돈다(시험). 'electron'은 index.ts와 ipc.ts에서만
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/index.ts', 'src/main/ipc.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...electron, '**/renderer/**'] }],
    },
  },
  {
    // shared는 렌더러도 가져간다: 타입과 상수만, core는 'import type'만
    files: ['src/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins,
          patterns: [
            { group: electron },
            { group: ['**/core/**'], allowTypeImports: true },
            { group: ['**/adapters/**', '**/engine/**', '**/cli/**', ...appLayers] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins,
          patterns: [
            { group: electron },
            { group: ['**/core/**'], allowTypeImports: true },
            {
              group: ['**/adapters/**', '**/engine/**', '**/cli/**', '**/main/**', '**/preload/**'],
            },
          ],
        },
      ],
    },
  },
)
