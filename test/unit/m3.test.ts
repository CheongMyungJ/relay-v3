// [단위] M3 장치의 스위치(V39, engine/m3.ts: knowledge M3a, debt M3b, tidy M3c, promote M3d): 프로젝트 설정은 장치마다, RELAY_M3이 있으면 그것이 모두를 덮는다
import { describe, expect, test } from 'vitest'
import {
  M3_DEFAULT,
  M3_DEVICES,
  M3_OFF,
  M3_ON,
  m3Settings,
  m3Switches,
} from '../../src/engine/m3.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/api.ts'

describe('m3Settings', () => {
  test('기본은 지식 잇기만 끔(V44: 장기 평가에서 δ 안)이고 프로젝트 설정의 기본값과 같다', () => {
    expect(M3_DEFAULT).toEqual({ knowledge: false, debt: true, tidy: true, promote: true })
    expect(m3Settings(undefined)).toEqual(M3_DEFAULT)
    expect(DEFAULT_SETTINGS.m3).toEqual(M3_DEFAULT)
    expect(Object.keys(M3_ON)).toEqual([...M3_DEVICES])
    expect(Object.keys(M3_DEFAULT)).toEqual([...M3_DEVICES])
    expect(Object.keys(M3_OFF)).toEqual([...M3_DEVICES])
  })

  test('장치마다 참·거짓만 받고 틀린 칸과 모르는 장치는 버린다(빈 칸은 기본값)', () => {
    expect(m3Settings({ knowledge: true })).toEqual({ ...M3_DEFAULT, knowledge: true })
    expect(m3Settings({ knowledge: 'no', debt: 0, rules: false, promote: 'off' })).toEqual(
      M3_DEFAULT,
    )
    expect(m3Settings({ debt: false })).toEqual({ ...M3_DEFAULT, debt: false })
    expect(m3Settings({ tidy: false })).toEqual({ ...M3_DEFAULT, tidy: false })
    expect(m3Settings({ promote: false })).toEqual({ ...M3_DEFAULT, promote: false })
    expect(m3Settings({ knowledge: true, debt: true, tidy: true, promote: true })).toEqual(M3_ON)
    expect(m3Settings('off')).toEqual(M3_DEFAULT)
  })
})

describe('m3Switches', () => {
  test('RELAY_M3이 없거나 비면 프로젝트 설정(없으면 기본값)', () => {
    for (const env of [undefined, '', '  ']) {
      expect(m3Switches({ knowledge: true }, env)).toEqual({
        switches: { ...M3_DEFAULT, knowledge: true },
        errors: [],
      })
      expect(m3Switches(undefined, env)).toEqual({ switches: M3_DEFAULT, errors: [] })
    }
  })

  test.each(['off', 'OFF', '0', 'none', 'false'])('%s는 모두 끔(relay3-m2 쪽)', (env) => {
    expect(m3Switches({ knowledge: true }, env)).toEqual({ switches: M3_OFF, errors: [] })
  })

  test.each(['on', 'all', '1', 'true'])('%s는 프로젝트 설정과 상관없이 모두 켬', (env) => {
    expect(m3Switches({ knowledge: false }, env)).toEqual({ switches: M3_ON, errors: [] })
  })

  test('쉼표로 이은 이름은 그 장치만 켜고, 모르는 이름은 알린다', () => {
    expect(m3Switches({ knowledge: false }, 'knowledge')).toEqual({
      switches: { ...M3_OFF, knowledge: true },
      errors: [],
    })
    expect(m3Switches({ debt: false }, 'debt')).toEqual({
      switches: { ...M3_OFF, debt: true },
      errors: [],
    })
    expect(m3Switches({ tidy: false }, 'tidy')).toEqual({
      switches: { ...M3_OFF, tidy: true },
      errors: [],
    })
    expect(m3Switches({ promote: false }, 'promote')).toEqual({
      switches: { ...M3_OFF, promote: true },
      errors: [],
    })
    expect(m3Switches(undefined, 'rules, knowledge,')).toEqual({
      switches: { ...M3_OFF, knowledge: true },
      errors: ["RELAY_M3: 모르는 장치 'rules' (knowledge, debt, tidy, promote)"],
    })
  })
})
