// M2 평가 Q4의 사후 계산 (log.md '배치 1 도중'). 규약의 Q4 값과 따로, '사후'로만 보인다.
// 평가 빌드의 시험 수 래칫은 있던 시험에 예시 태그를 붙이면 옛 이름을 '사라진 시험'으로 읽었다(거짓 양성). 저장된 내보내기
// 증거(works/<id>/evidence.json)에서 tests 래칫이 그렇게 나빠졌고, 사라진 이름마다 그 Work의 diff(final/<id>.diff)에
// 같은 이름에 예시 태그를 붙인 시험이 더해졌으면 그 래칫을 수만으로 다시 정한다. 그 증거로 관문(src/core/gate.ts, 순수
// 함수)을 다시 돌려 자동 조건을 채웠는지 보고, 숨긴 시험 결과(run.json outcome)와 견줘 G1·G2를 낸다.
// 래칫 말고는 아무것도 바꾸지 않는다. 증거가 내보내기 때의 것이 아니면(리뷰 없음, head가 다름) 다시 계산하지 않는다.
//   node docs/experiments/m2/posthoc-q4.mjs <결과 폴더>...   (relay-v2 app/eval/results/m2-* 또는 runs/*.tar.gz를 푼 곳)

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gate } from '../../../src/core/gate.ts'
import { DRAFT_AUTO } from '../../../src/core/quality.ts'

const ARMS = ['relay3', 'relay3-noreview']
const TAG = String.raw`\s*\[[A-Za-z0-9][A-Za-z0-9._-]*:C\d+\.\d+\]\s*`
const GONE = /^기준에서 돌던 시험이 사라짐: (.*) \(시험 수 (\d+) → (\d+)\)$/

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 래칫의 사라진 이름이 모두 diff에서 태그만 붙어 다시 더해졌으면 수만으로 다시 정한 래칫, 아니면 null */
export function retagged(ratchet, diff) {
  if (ratchet?.id !== 'tests' || ratchet.status !== 'worse') return null
  const m = GONE.exec(ratchet.detail ?? '')
  if (!m || / 외 \d+개$/.test(m[1])) return null
  const names = m[1].split(', ').map((n) => n.split(' > ').at(-1))
  const added = diff.split('\n').filter((l) => l.startsWith('+'))
  // 태그는 이름 앞이나 뒤에 붙는다('[c:C1.1] 홀수 개', '홀수 개 [c:C1.1]')
  const tagged = (n) => new RegExp(`['"\`]${TAG}\\s*${escape(n)}['"\`]|['"\`]${escape(n)}${TAG}['"\`]`)
  const ok = names.every((n) => added.some((l) => tagged(n).test(l)))
  if (!ok) return null
  const base = Number(m[2])
  const head = Number(m[3])
  const status = head === base ? 'same' : head > base ? 'better' : 'worse'
  return { ...ratchet, status, detail: `시험 수 ${base} → ${head} (사후: 태그만 붙인 시험은 같은 시험)` }
}

const POLICY = {
  auto_merge_enabled: false,
  conditions: [{ ...DRAFT_AUTO }],
  server: null,
  track_record_ok: {},
}

/** 한 실행의 내보내기 Work마다 원래 결론과 사후 결론 */
function works(runDir, run) {
  const out = []
  for (const w of run.works ?? []) {
    if (!w.gate?.export) continue
    const dir = path.join(runDir, 'works', w.id)
    const evPath = path.join(dir, 'evidence.json')
    const row = { id: w.id, before: w.gate.condition !== null, after: null, why: null }
    if (!existsSync(evPath)) {
      out.push({ ...row, why: '증거 없음' })
      continue
    }
    const ev = readJson(evPath)
    if (w.exportedHead && ev.head !== w.exportedHead) {
      out.push({ ...row, why: '증거가 내보내기 뒤의 것' })
      continue
    }
    const diffPath = path.join(runDir, 'final', `${w.id}.diff`)
    const diff = existsSync(diffPath) ? readFileSync(diffPath, 'utf8') : ''
    const contractPath = path.join(dir, 'contract.json')
    const contract = existsSync(contractPath) ? readJson(contractPath) : null
    let fixed = 0
    const ratchets = (ev.ratchets ?? []).map((r) => {
      const f = retagged(r, diff)
      if (f) fixed++
      return f ?? r
    })
    const g = gate({ ...ev, ratchets }, contract, POLICY, ev.head)
    out.push({ ...row, after: g.condition !== null, fixed, reasons: g.reasons })
  }
  return out
}

function runs(folders) {
  const out = []
  for (const folder of folders) {
    for (const scenario of readdirSync(folder, { withFileTypes: true })) {
      if (!scenario.isDirectory()) continue
      const sDir = path.join(folder, scenario.name)
      for (const r of readdirSync(sDir, { withFileTypes: true })) {
        const arm = r.name.replace(/-\d+$/, '')
        if (!r.isDirectory() || !ARMS.includes(arm)) continue
        const runDir = path.join(sDir, r.name)
        if (!existsSync(path.join(runDir, 'run.json'))) continue
        const run = readJson(path.join(runDir, 'run.json'))
        if (run.error) continue
        const hands = run.options?.humanMode === 'hands-off' ? '-handsoff' : ''
        out.push({
          arm: arm + hands,
          scenario: scenario.name,
          name: r.name,
          success: typeof run.outcome?.success === 'boolean' ? run.outcome.success : null,
          works: works(runDir, run),
        })
      }
    }
  }
  return out
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : '-')

/** 사람 머지 까닭의 갈래(첫 낱말 묶음): 무엇이 자동 조건을 막는지 */
function kind(reason) {
  const m = /^(리뷰 올림|래칫 나빠짐|명령|줄|신호|증거 없음|계약|채운 자동 조건 없음|조건 \w+)/.exec(reason)
  return m ? m[1] : reason.slice(0, 20)
}

function report(all) {
  const lines = ['# M2 Q4 사후 계산 (래칫 태그 거짓 양성을 고친 관문)', '']
  lines.push('| 쪽 | 판정한 실행 | 내보내기 실행 | 자동 조건(규약) | 자동 조건(사후) | G1 사후 | G2 사후 | 다시 못 잰 Work |')
  lines.push('|---|---|---|---|---|---|---|---|')
  const arms = [...new Set(all.map((r) => r.arm))].sort()
  for (const arm of arms) {
    const rs = all.filter((r) => r.arm === arm && r.success !== null)
    const exported = rs.filter((r) => r.works.length > 0)
    const before = exported.filter((r) => r.works.some((w) => w.before))
    const after = exported.filter((r) => r.works.some((w) => w.after ?? w.before))
    const pass = exported.filter((r) => r.success)
    const skipped = exported.flatMap((r) => r.works).filter((w) => w.after === null).length
    lines.push(
      `| ${arm} | ${rs.length} | ${exported.length} | ${before.length} | ${after.length} | ${pct(after.filter((r) => r.success).length, after.length)} | ${pct(pass.filter((r) => after.includes(r)).length, pass.length)} | ${skipped} |`,
    )
  }
  lines.push('', '## 사후에도 사람 머지로 간 까닭 (내보내기 Work, 까닭마다 센 수)', '')
  for (const arm of arms) {
    const counts = new Map()
    for (const w of all.filter((r) => r.arm === arm).flatMap((r) => r.works)) {
      if (w.after !== false) continue
      for (const k of new Set((w.reasons ?? []).map(kind))) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const text = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`)
    lines.push(`- ${arm}: ${text.join(', ') || '-'}`)
  }
  const fixedWorks = all.flatMap((r) => r.works.filter((w) => w.fixed > 0).map((w) => `${r.scenario}/${r.name}/${w.id}`))
  lines.push('', `래칫을 고친 Work ${fixedWorks.length}개: ${fixedWorks.join(', ') || '-'}`)
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const folders = process.argv.slice(2)
  if (folders.length === 0) {
    console.error('쓰는 법: node docs/experiments/m2/posthoc-q4.mjs <결과 폴더>...')
    process.exit(1)
  }
  console.log(report(runs(folders)))
}
