// [단위] M3 장치의 스위치(V39, engine/m3.ts: knowledge M3a, debt M3b, tidy M3c): 프로젝트 설정은 장치마다, RELAY_M3이 있으면 그것이 모두를 덮는다
import { describe, expect, test } from 'vitest'
import { M3_DEVICES, M3_OFF, M3_ON, m3Settings, m3Switches } from '../../src/engine/m3.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/api.ts'

describe('m3Settings', () => {
  test('기본은 모두 켬이고 프로젝트 설정의 기본값과 같다', () => {
    expect(m3Settings(undefined)).toEqual(M3_ON)
    expect(DEFAULT_SETTINGS.m3).toEqual(M3_ON)
    expect(Object.keys(M3_ON)).toEqual([...M3_DEVICES])
    expect(Object.keys(M3_OFF)).toEqual([...M3_DEVICES])
  })

  test('장치마다 참·거짓만 받고 틀린 칸과 모르는 장치는 버린다', () => {
    expect(m3Settings({ knowledge: false })).toEqual({ knowledge: false, debt: true, tidy: true })
    expect(m3Settings({ knowledge: 'no', debt: 0, rules: false })).toEqual(M3_ON)
    expect(m3Settings({ debt: false })).toEqual({ knowledge: true, debt: false, tidy: true })
    expect(m3Settings({ tidy: false })).toEqual({ knowledge: true, debt: true, tidy: false })
    expect(m3Settings('off')).toEqual(M3_ON)
  })
})

describe('m3Switches', () => {
  test('RELAY_M3이 없거나 비면 프로젝트 설정', () => {
    for (const env of [undefined, '', '  '])
      expect(m3Switches({ knowledge: false }, env)).toEqual({
        switches: { knowledge: false, debt: true, tidy: true },
        errors: [],
      })
  })

  test.each(['off', 'OFF', '0', 'none', 'false'])('%s는 모두 끔(relay3-m2 쪽)', (env) => {
    expect(m3Switches({ knowledge: true }, env)).toEqual({ switches: M3_OFF, errors: [] })
  })

  test.each(['on', 'all', '1', 'true'])('%s는 프로젝트 설정과 상관없이 모두 켬', (env) => {
    expect(m3Switches({ knowledge: false }, env)).toEqual({ switches: M3_ON, errors: [] })
  })

  test('쉼표로 이은 이름은 그 장치만 켜고, 모르는 이름은 알린다', () => {
    expect(m3Switches({ knowledge: false }, 'knowledge')).toEqual({
      switches: { knowledge: true, debt: false, tidy: false },
      errors: [],
    })
    expect(m3Switches({ debt: false }, 'debt')).toEqual({
      switches: { knowledge: false, debt: true, tidy: false },
      errors: [],
    })
    expect(m3Switches({ tidy: false }, 'tidy')).toEqual({
      switches: { knowledge: false, debt: false, tidy: true },
      errors: [],
    })
    expect(m3Switches(undefined, 'rules, knowledge,')).toEqual({
      switches: { knowledge: true, debt: false, tidy: false },
      errors: ["RELAY_M3: 모르는 장치 'rules' (knowledge, debt, tidy)"],
    })
  })
})
