// relay record (M4c, docs/m4-design.md 5.2): $RELAY_HOME의 실적 장부에서 조건별 실적 표를 찍는다. 앱의 설정 대화상자 [실적]과
// 같은 셈(engine/shadow.ts recordStats)이다. 주간 기록과 M5 판정 문서가 --json을 쓴다. 장부는 읽기만 한다.
//   relay record [--json] [--project <경로>] [--all-epochs] [--pool]
// --project가 없으면 지금 폴더의 레포. --pool은 프로젝트를 넘어 합친 값(Q11: 보이기만, 기준에 쓰지 않는다).

import { parseArgs } from 'node:util'
import { repoRoot } from '../adapters/git.ts'
import { readLedgerText, relayHome, repoKey } from '../adapters/store.ts'
import { parseRecord } from '../engine/after-merge.ts'
import { recordStats } from '../engine/shadow.ts'
import type {
  AfterStats,
  ConditionStats,
  ControlStats,
  RecordStats,
  SessionStats,
} from '../shared/api.ts'

export interface RecordIo {
  cwd: string
  env: NodeJS.ProcessEnv
  out(text: string): void
  now(): Date
}

export async function recordCommand(
  io: RecordIo,
  args: string[],
  usage: (text: string) => Error,
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean' },
      project: { type: 'string' },
      'all-epochs': { type: 'boolean' },
      pool: { type: 'boolean' },
    },
    strict: true,
  })
  const pool = values.pool === true
  let project: string | null = null
  if (!pool) {
    const dir = values.project ?? io.cwd
    const root = await repoRoot(dir).catch(() => {
      throw usage(`git 레포가 아님: ${dir}`)
    })
    project = repoKey(root)
  }
  const r = parseRecord(await readLedgerText(relayHome(io.env)))
  const stats = recordStats({
    entries: r.entries,
    after: r.after,
    disputes: r.disputes,
    scope: project === null ? { pool: true } : { project },
    now: io.now().toISOString(),
    allEpochs: values['all-epochs'] === true,
    broken: r.broken,
  })
  if (values.json === true) {
    io.out(JSON.stringify({ project: project ?? 'pool', ...stats }, null, 2))
    return 0
  }
  for (const line of recordText(project ?? '여러 레포 합침(보이기만)', stats)) io.out(line)
  return 0
}

const nonZero = (o: Record<string, number>) =>
  Object.entries(o)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '없음'

function afterLine(a: AfterStats): string {
  if (a.merges === 0) return '머지 뒤: 머지 없음'
  const upper = a.upper === null ? '' : ` (위 한계 약 ${a.upper.toFixed(2)})`
  return (
    `머지 뒤(창 닫힘 ${a.closed}, 지켜보는 중 ${a.watching}): 되돌림 ${a.reverts}, main ${nonZero(a.main)}` +
    `, 잴 수 없음 ${a.unmeasurable}, 이의 ${a.disputed}${upper}`
  )
}

const controlLine = (c: ControlStats) => `그대로 머지 ${c.as_is}/${c.n} · ${afterLine(c.after)}`

function conditionLines(s: ConditionStats): string[] {
  const low = s.wilson_low === null ? '' : ` (하한 ${s.wilson_low.toFixed(2)})`
  const lift = s.lift === null ? '모름' : s.lift.toFixed(2)
  return [
    `${s.id}${s.cond_hash ? ` (${s.cond_hash})` : ''} · 일치 ${s.match}/${s.n}${low}`,
    `  불일치: ${nonZero(s.miss)} · 분모 밖: ${nonZero(s.outside)}`,
    `  ${afterLine(s.after)}`,
    `  비교군: ${controlLine(s.control)} · lift ${lift}`,
    `  함께 센 표본 ${s.correlated} · 30일 내보내기 ${s.inflow.exports_30d}, 이 조건 ${s.inflow.met_30d}`,
  ]
}

/** 세션 커밋 가르기(M4e)의 지표 한 줄 */
function sessionLine(s: SessionStats): string {
  return (
    `세션 커밋 · 내보낸 뒤 사람 교정 ${s.corrected}/${s.merges} (가르지 못한 머지 ${s.unclassified})` +
    ` · 내보낸 뒤 커밋: ${nonZero(s.commits)}` +
    ` · 집합과 트레일러가 다름 ${s.disagree} · 집합만으로 가름 ${s.set_only}` +
    ` · 트레일러 덮임 ${s.trailered}/${s.watched} (Work ${s.works}) · 훅 위임 사고 ${s.incidents}`
  )
}

/** 사람이 읽는 표 */
export function recordText(name: string, r: RecordStats): string[] {
  const e = r.current
  const epoch =
    r.epoch === 'all' || !e
      ? '모든 판'
      : `이 판: 모델 ${e.model ?? '모름'}, effort ${e.effort ?? '모름'}, Claude Code ${e.claude ?? '모름'}, 관문 판 ${e.gate_epoch ?? '모름'}, 리뷰 프롬프트 ${e.review_prompt ?? '모름'}`
  return [
    `실적: ${name}`,
    epoch,
    ...(r.conditions.length === 0 ? ['자동 조건을 채운 내보내기가 아직 없음'] : []),
    ...r.conditions.flatMap(conditionLines),
    `사람 경로(조건 못 채움) · ${controlLine(r.human)}`,
    ...r.changes.map((c) => `판이 바뀜(${c.ts}): ${c.fields.join(', ')}`),
    sessionLine(r.sessions),
    `판을 모르는 결론 줄 ${r.unknown_epoch.lines}/${r.unknown_epoch.of} · 읽지 못한 장부 줄 ${r.broken}`,
  ]
}
