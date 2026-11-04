import { ok } from '../../src/core/result.ts'
import { test, expect } from 'vitest'
test('ok', () => expect(ok(1)).toEqual({ ok: true, value: 1 }))
