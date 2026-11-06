// M3 장치의 스위치 (docs/m3-design.md 1절, V38). 장치는 하나씩 켜며 잰다(원칙 5): 프로젝트 설정 m3이 장치마다 켜고 끄고,
// 환경 변수 RELAY_M3이 있으면 그것이 모두를 덮는다. 장기 평가의 relay3-m2 쪽은 RELAY_M3=off 하나로 M3 장치를 모두 끈다.
// 값: off(또는 0, none) 모두 끔, on(또는 1, all) 모두 켬, 쉼표로 이은 장치 이름(knowledge: 지식 잇기 M3a, debt: 받아들인
// 나빠짐의 빚 기록 M3b, tidy: 곁들일 정리 M3c, promote: 규칙 승격 M3d) 그것만 켬. 비었으면 프로젝트 설정(기본 M3_DEFAULT).

import type { M3Device, M3Switches } from '../core/types.ts'

export const M3_DEVICES: readonly M3Device[] = ['knowledge', 'debt', 'tidy', 'promote']

/** 모두 켬(RELAY_M3=on) */
export const M3_ON: Readonly<M3Switches> = {
  knowledge: true,
  debt: true,
  tidy: true,
  promote: true,
}

/** 모두 끔. M3 앞에 만든 Work의 기록도 이것으로 읽는다 */
export const M3_OFF: Readonly<M3Switches> = {
  knowledge: false,
  debt: false,
  tidy: false,
  promote: false,
}

/**
 * 프로젝트 설정의 기본값(shared/api.ts `DEFAULT_SETTINGS.m3`과 같다). 지식 잇기는 끔: M3 장기 평가(2026-11-06)에서 켠 쪽과
 * 끈 쪽의 다시 말하기·누적 숨긴 시험이 δ 안이라 기본에서 뺐다(V44, 규약 6절 규칙 3). 코드는 남긴다. 나머지는 켬
 */
export const M3_DEFAULT: Readonly<M3Switches> = {
  knowledge: false,
  debt: true,
  tidy: true,
  promote: true,
}

const all = (on: boolean): M3Switches => ({ ...(on ? M3_ON : M3_OFF) })

/** 저장된 설정을 읽는다. 없거나 틀린 칸은 기본값(M3_DEFAULT) */
export function m3Settings(raw: unknown): M3Switches {
  const s = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const out = { ...M3_DEFAULT }
  for (const d of M3_DEVICES) if (typeof s[d] === 'boolean') out[d] = s[d]
  return out
}

/**
 * 이 Work의 스위치: env(RELAY_M3)가 있으면 그것, 없으면 프로젝트 설정. 모르는 이름은 버리고 errors에 적는다(장치 이름의
 * 오타가 조용히 모두 끔이 되지 않게 부른 쪽이 알린다)
 */
export function m3Switches(
  project: unknown,
  env: string | undefined,
): { switches: M3Switches; errors: string[] } {
  const v = (env ?? '').trim().toLowerCase()
  if (v === '') return { switches: m3Settings(project), errors: [] }
  if (['off', '0', 'none', 'false'].includes(v)) return { switches: all(false), errors: [] }
  if (['on', '1', 'all', 'true'].includes(v)) return { switches: all(true), errors: [] }
  const out = all(false)
  const errors: string[] = []
  for (const name of v.split(',').map((n) => n.trim())) {
    if (name === '') continue
    if ((M3_DEVICES as readonly string[]).includes(name)) out[name as M3Device] = true
    else errors.push(`RELAY_M3: 모르는 장치 '${name}' (${M3_DEVICES.join(', ')})`)
  }
  return { switches: out, errors }
}
