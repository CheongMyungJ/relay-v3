// [단위] 빚 확인의 글(M3b, src/renderer/src/debt.ts): 묻는 때(장치, one_branch, 지금 HEAD의 나빠진 래칫, 아직 기록하지
// 않음)와 확인·[계약] 알림의 글
import { describe, expect, test } from 'vitest'
import type { EvidenceBundle, RatchetResult } from '../../src/core/types.ts'
import { debtAsk, debtCommitText, debtTexts, unrecordedText } from '../../src/renderer/src/debt.ts'
import type { WorkView } from '../../src/shared/api.ts'

const WORSE: RatchetResult = {
  id: 'file-size',
  status: 'worse',
  detail: '600줄을 넘음: src/big.js(700)',
  offenders: [{ path: 'src/big.js', head: 700 }],
}

function view(ratchets: RatchetResult[], more: Partial<EvidenceBundle> = {}) {
  const evidence = { head: 'h1', ratchets, ...more } as EvidenceBundle
  return {
    m3: { knowledge: true, debt: true, tidy: true },
    exports: [] as WorkView['exports'],
    evidence,
    head: 'h1' as string | null,
  }
}

describe('debtAsk', () => {
  test('지금 HEAD의 Work 브랜치 증거에 나빠진 래칫이 있으면 래칫마다 한 줄', () => {
    const same: RatchetResult = { id: 'tests', status: 'same', detail: '시험 수 3 → 3' }
    expect(debtAsk(view([WORSE, same]))).toEqual(['file-size (600줄을 넘음: src/big.js(700))'])
    // HEAD를 모르면 증거대로
    expect(debtAsk({ ...view([WORSE]), head: null })).toHaveLength(1)
  })

  test('묻지 않는 때: 나빠짐 없음, 이미 기록함, 낡은 증거, 장치 꺼짐, 단위 브랜치(V22), 증거 없음', () => {
    expect(debtAsk(view([]))).toBeNull()
    expect(debtAsk(view([WORSE], { debt_commit: { from: 'h0', items: ['x'] } }))).toBeNull()
    expect(debtAsk({ ...view([WORSE]), head: 'h2' })).toBeNull()
    expect(
      debtAsk({ ...view([WORSE]), m3: { knowledge: true, debt: false, tidy: true } }),
    ).toBeNull()
    const units = [{ unit: 'api' }] as WorkView['exports']
    expect(debtAsk({ ...view([WORSE]), exports: units })).toBeNull()
    expect(debtAsk({ ...view([WORSE]), evidence: null })).toBeNull()
  })

  test('빚을 기록한 뒤 다시 잰 증거: 이 diff의 빚이 모두 덮은 래칫은 묻지 않고, 덮지 않은 래칫만 묻는다', () => {
    const tests: RatchetResult = { id: 'tests', status: 'worse', detail: '시험 수 3 → 2' }
    const covered = { debt_covered: { ratchets: ['file-size'], items: ['r-file-size-src-big-js'] } }
    expect(debtAsk(view([WORSE], covered))).toBeNull()
    expect(debtAsk(view([WORSE, tests], covered))).toEqual(['tests (시험 수 3 → 2)'])
  })
})

describe('debtTexts', () => {
  test('래칫 하나는 이름과 까닭, 여럿은 수. 단추는 [빚으로 남기고 …]와 [그냥 …]', () => {
    expect(debtTexts(['file-size (640줄)'], '머지')).toMatchObject({
      title: '래칫 file-size (640줄)가 나빠졌습니다. 빚으로 남기고 머지할까요?',
      record: '빚으로 남기고 머지',
      skip: '그냥 머지',
    })
    expect(debtTexts(['a', 'b'], '끝내기')).toMatchObject({
      title: '래칫 2개가 나빠졌습니다. 빚으로 남기고 끝낼까요?',
      record: '빚으로 남기고 끝내기',
      skip: '그냥 끝내기',
    })
  })

  test('증거의 빚 기록 커밋', () => {
    expect(debtCommitText({})).toBeNull()
    expect(debtCommitText({ debt_commit: { from: 'abcdef0123', items: ['a', 'b'] } })).toEqual({
      text: '빚 기록 커밋(잰 abcdef0)',
      title:
        'relay가 잰 head abcdef0 위에 빚 2개(a, b)를 커밋했습니다. .relay/debt/만 더해 다시 재지 않았습니다.',
    })
  })

  test('[계약]의 기록 안 된 나빠짐은 있을 때만', () => {
    expect(unrecordedText({ unrecorded: [] })).toBeNull()
    expect(unrecordedText({ unrecorded: ['file-size: src/a.js 500 → 700'] })).toContain('빚으로')
  })
})
