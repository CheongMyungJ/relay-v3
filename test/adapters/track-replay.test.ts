// [어댑터] 재생 실적 자료 쓰기(scripts/track-replay.ts, docs/m4-design.md 9절)가 실제 결과 폴더를 읽을 때, 묶은 기록에서 빠진
// 파일(M3 runs/의 앱 저장소, M2 runs/의 *.extra에 따로 둔 증거·final diff)을 조용히 빈 장부나 '모름'으로 바꾸지 않고 센다.
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { trackWorks } from '../../scripts/track-replay.ts'
import { cleanupAll, makeTempDir, writeFiles } from '../support/repo.ts'

afterAll(cleanupAll)

const HEAD = 'a'.repeat(40)
const conclusion = (work: string) =>
  JSON.stringify({
    ts: '2026-11-04T10:00:00.000Z',
    project: '/repo',
    work,
    head: HEAD,
    conclusion: 'human_merge',
    condition: null,
    shadow: false,
    relay_version: '0.0.0',
  })

describe('track-replay: 묶은 기록에서 빠진 파일을 센다', () => {
  test('M3 순차 실행에 앱 저장소(work-NN/works)가 없으면 장부 파일 없음으로 센다', async () => {
    const root = await makeTempDir('relay-track-replay-m3-')
    await writeFiles(join(root, '48-long-shop', 'relay3-1'), {
      'run.json': JSON.stringify({
        complete: true,
        works: [{ work: 1, outcome: { success: true }, appWorks: [{ id: 'w1', merged: true }] }],
      }),
    })
    const { works, counts } = trackWorks('m3', [root])
    expect(works).toHaveLength(1)
    expect(works[0]?.ledger).toEqual([])
    expect(counts.get('장부 파일 없음(이 Work의 장부 줄 없음)')).toBe(1)
  })

  test('M2 실행에 증거나 final diff가 없으면 같은 변경을 가르지 못함으로 센다, 있으면 세지 않는다', async () => {
    const root = await makeTempDir('relay-track-replay-m2-')
    const run = join(root, '10-invoice-rounding', 'relay3-1')
    await writeFiles(root, { 'report.json': '{}\n' })
    await writeFiles(run, {
      'run.json': JSON.stringify({
        error: null,
        outcome: { success: true },
        works: [{ id: 'w1', end: 'confirmed' }],
      }),
      'works/w1/ledger.jsonl': `${conclusion('w1')}\n`,
    })
    const missing = trackWorks('m2', [root])
    expect(missing.works[0]?.end).toEqual({ kind: 'ended', same_as_export: null })
    expect(missing.counts.get('같은 변경을 가르지 못함: evidence.json이나 final diff 없음')).toBe(1)
    // *.extra를 함께 풀면(증거와 final diff) 가른다
    const diff =
      'diff --git a/base/x.js b/tree/x.js\n--- a/base/x.js\n+++ b/tree/x.js\n@@ -1 +1 @@\n-a\n+b\n'
    await writeFiles(run, {
      'final/w1.diff': diff,
      'works/w1/evidence.json': JSON.stringify({
        head: HEAD,
        diff: { files: 1, added: 1, deleted: 1, paths: ['x.js'] },
      }),
    })
    const found = trackWorks('m2', [root])
    expect(found.works[0]?.end).toEqual({ kind: 'ended', same_as_export: true })
    expect(found.counts.has('같은 변경을 가르지 못함: evidence.json이나 final diff 없음')).toBe(
      false,
    )
    expect(found.counts.has('장부 파일 없음(이 Work의 장부 줄 없음)')).toBe(false)
    // 증거가 마지막 결론 줄과 다른 head면 null의 까닭을 센다
    await writeFiles(run, {
      'works/w1/evidence.json': JSON.stringify({
        head: 'b'.repeat(40),
        diff: { files: 1, added: 1, deleted: 1, paths: ['x.js'] },
      }),
    })
    const other = trackWorks('m2', [root])
    expect(other.works[0]?.end).toEqual({ kind: 'ended', same_as_export: null })
    expect(other.counts.get('같은 변경을 가르지 못함: 증거가 마지막 결론 줄과 다른 head')).toBe(1)
  })

  test('실행을 무리마다 셈과 뺌(까닭)으로 센다: 오류, 숨긴 시험 결과 없음, run.json 없음', async () => {
    const root = await makeTempDir('relay-track-replay-runs-')
    const s = join(root, '08-timezone')
    await writeFiles(root, { 'report.json': '{}\n' })
    const ok = { error: null, outcome: { success: true }, works: [] }
    await writeFiles(join(s, 'relay3-1'), { 'run.json': JSON.stringify(ok) })
    await writeFiles(join(s, 'relay3-2'), { 'run.json': JSON.stringify({ ...ok, error: 'x' }) })
    await writeFiles(join(s, 'relay3-3'), { 'run.json': JSON.stringify({ ...ok, outcome: null }) })
    await writeFiles(join(s, 'relay3-4'), { 'runner.log': '' })
    const { counts } = trackWorks('m4', [root])
    expect(counts.get('실행 셈: 08-timezone/relay3')).toBe(1)
    expect(counts.get('실행 뺌(오류로 끝남): 08-timezone/relay3')).toBe(1)
    expect(counts.get('실행 뺌(숨긴 시험 결과 없음): 08-timezone/relay3')).toBe(1)
    expect(counts.get('실행 뺌(run.json 없음): 08-timezone/relay3')).toBe(1)
  })
})
