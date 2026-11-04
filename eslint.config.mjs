import { builtinModules } from 'node:module'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// 층 규칙 (docs/design.md 5절): core ← adapters ← engine ← cli
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]

export default tseslint.config(
  { ignores: ['node_modules/', '.relay-out/', 'test-results/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins,
          patterns: ['**/adapters/**', '**/engine/**', '**/cli/**'],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/engine/**', '**/cli/**'] }],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/cli/**'] }],
    },
  },
)
