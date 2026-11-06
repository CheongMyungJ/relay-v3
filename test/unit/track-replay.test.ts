// [단위] 재생 실적(M4g, m4-design 9절, V53). 지난 평가의 relay3 쪽 Work 장부(test/fixtures/track-replay/, scripts/track-replay.ts가
// 만든다)로 네 표를 모델 호출 없이 센다: (1) 조건별 그림자 정밀도·재현율, (2) AI 사람 역할과의 일치(engine shadowStats), (3) 머지
// 뒤 대리 지표(M3 순차), (4) 생성 안정성(관문 5회 C). npm run test:track이 표를 찍는다. 판정은 M4 규약(15절)에서 하고, 여기서는
// 자료와 셈이 맞는지(설계 때 손으로 센 값이 다시 나오는지)만 본다. 제품 실적(trackRecord, $RELAY_HOME)에 섞지 않는다.
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isLedgerEntry } from '../../src/engine/ledger.ts'
import { shadowStats } from '../../src/engine/shadow.ts'
import { diffStats } from '../../scripts/track-replay.ts'
import { readReplay } from '../support/gate-replay.ts'
import {
  afterProxy,
  agreementTable,
  ledgerOf,
  metBy,
  precisionTable,
  readTrack,
  report,
  workName,
  type TrackWork,
} from '../support/track-replay.ts'

const WORKS = readTrack(fileURLToPath(new URL('../fixtures/track-replay/', import.meta.url)))
const BUNDLES = readReplay(fileURLToPath(new URL('../fixtures/gate-replay/', import.meta.url)))

/** 자료 줄의 칸(숨긴 시험의 본문·이름·출력, 모델 이름 같은 실행 설정은 넣지 않는다) */
const FIELDS = new Set([
  'protocol',
  'scenario',
  'arm',
  'run',
  'seq',
  'work',
  'hidden_pass',
  'ledger',
  'end',
  'later',
  'main',
])

const LINE: TrackWork['ledger'][number] = {
  ts: '2026-11-04T00:00:00.000Z',
  head: 'h1',
  conclusion: 'human_merge',
  condition: 'small',
  shadow: true,
}

const work = (over: Partial<TrackWork>): TrackWork => ({
  protocol: 'm2',
  scenario: 's',
  arm: 'relay3',
  run: 1,
  work: 'w1',
  hidden_pass: true,
  ledger: [LINE],
  end: { kind: 'ended', same_as_export: true },
  ...over,
})

describe('재생 실적 자료', () => {
  test('규약마다 Work가 있고 이름이 겹치지 않으며 칸은 정한 것만', () => {
    const names = WORKS.map(workName)
    expect(new Set(names).size).toBe(names.length)
    expect([...new Set(WORKS.map((w) => w.protocol))].sort()).toEqual(['m2', 'm2.1', 'm3'])
    const extra = WORKS.flatMap((w) => Object.keys(w).filter((k) => !FIELDS.has(k)))
    expect(extra).toEqual([])
    // 장부 줄로 바꾸면 모두 engine의 장부 줄 모양이다
    const bad = WORKS.flatMap((w) => ledgerOf(w, true)).filter((e) => !isLedgerEntry(e))
    expect(bad).toEqual([])
    // M3 순차만 later·main이 있다
    expect(WORKS.every((w) => (w.protocol === 'm3') === (w.later !== undefined))).toBe(true)
  })

  test('설계 때 손으로 센 값이 다시 나온다(9절: m2 relay3 5/65, M3 순차 90개 가운데 그림자 2개 일치 1·불일치 1)', () => {
    const m2 = WORKS.filter((w) => w.protocol === 'm2' && w.arm === 'relay3')
    expect([m2.filter((w) => metBy(w, 'small')).length, m2.length]).toEqual([5, 65])
    const m3 = WORKS.filter((w) => w.protocol === 'm3')
    expect(m3).toHaveLength(90)
    const s = agreementTable(m3, false)[0]?.stats['small']
    expect([s?.n, s?.match, s?.miss.more_unknown]).toEqual([2, 1, 1])
  })

  test('네 표를 찍는다 (npm run test:track)', () => {
    const text = report(WORKS, BUNDLES)
    console.log(text)
    expect(text).toContain('표 1.')
    expect(text).toContain('표 4.')
  })
})

describe('재생 실적의 셈', () => {
  test('표 1: 조건을 채운 Work(그림자나 자동 후보의 결론 줄) 가운데 숨긴 시험 통과(G1), 통과 가운데 채움(G2)', () => {
    const rows = precisionTable(
      [
        work({}),
        work({ work: 'w2', hidden_pass: false }),
        work({ work: 'w3', ledger: [{ ...LINE, shadow: false }] }),
        work({ work: 'w4', ledger: [{ ...LINE, condition: null, met: [] }] }),
      ],
      ['small'],
    )
    expect(rows).toEqual([
      {
        protocol: 'm2',
        arm: 'relay3',
        condition: 'small',
        works: 4,
        pass: 3,
        met: 2,
        false_auto: 1,
        g1: 0.5,
        g2: 1 / 3,
      },
    ])
  })

  test('[끝내기]를 머지로 봄: 그대로면 일치, 더 바꿨으면 더 커밋, 가를 수 없으면 같은 변경을 모름', () => {
    const ends = [true, false, null].map((same, i) =>
      work({ work: `w${i}`, end: { kind: 'ended', same_as_export: same } }),
    )
    const entries = ends.flatMap((w) => ledgerOf(w, true))
    const s = shadowStats({ entries, scope: { pool: true }, epoch: 'all', now: null })['small']
    expect([s?.match, s?.miss.more_unknown, s?.miss.unknown_change]).toEqual([1, 1, 1])
    // 장부 그대로면 끝 줄이 없어 모두 열림(분모 밖)
    const asIs = ends.flatMap((w) => ledgerOf(w))
    const t = shadowStats({ entries: asIs, scope: { pool: true }, epoch: 'all', now: null })
    expect([t['small']?.n, t['small']?.outside.open]).toEqual([0, 3])
    // 옛 결론 줄에 초안 조건을 채워 비교군을 센다
    expect(ledgerOf(work({}))[0]?.conds).toEqual({ small: 'draft' })
  })

  test('표 3: 귀속 대리(main 레포 시험 실패, 앞 main 통과)가 누적 숨긴 시험의 깨뜨림을 잡는가', () => {
    const seq = (n: number, repo: boolean, regressed: number, met = false) =>
      work({
        protocol: 'm3',
        seq: n,
        work: `w${n}`,
        ledger: met ? work({}).ledger : [],
        end: { kind: 'merged' },
        later: { own_pass: true, checked: 0, first_broken: n === 2 ? 3 : null },
        main: { repo_tests: repo, regressed },
      })
    const a = afterProxy(
      [seq(1, true, 0, true), seq(2, false, 1), seq(3, false, 1), seq(4, true, 2)],
      'small',
    )
    // 2: 앞(1) 통과 → 귀속, 깨뜨림. 3: 앞(2)도 실패 → 물려받음(귀속 아님). 4: main 통과인데 깨뜨림 → 놓침
    expect(a).toEqual({
      works: 4,
      broke: 3,
      broken_later: 1,
      attributed: 1,
      caught: 1,
      precision: 1,
      recall: 1 / 3,
      shadow: { works: 1, broke: 0, broken_later: 0 },
    })
  })

  test('평가 diff(a/base/, b/tree/)의 파일과 줄 수: 새 파일과 지운 파일, 내용이 ---로 시작하는 줄', () => {
    const diff = [
      'diff --git a/tree/new.js b/tree/new.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tree/new.js',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/base/old.js b/base/old.js',
      'deleted file mode 100644',
      '--- a/base/old.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '--- 머리줄이 아닌 지운 줄',
      'diff --git a/base/src/x.js b/tree/src/x.js',
      '--- a/base/src/x.js',
      '+++ b/tree/src/x.js',
      '@@ -1,2 +1,2 @@',
      ' same',
      '-old',
      '+new',
      '',
    ].join('\n')
    expect(diffStats(diff)).toEqual({
      paths: ['new.js', 'old.js', 'src/x.js'],
      added: 3,
      deleted: 2,
    })
  })
})
