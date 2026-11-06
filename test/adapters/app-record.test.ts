// [어댑터] M4 평가 (C)의 앱 기록 셈(scripts/app-record.ts, M4 규약 4.7·4.8)이 실제 결과 폴더의 꼴(works/<id>/의 장부, 세션 커밋
// 기록, 사건, hooks.log)을 읽어 판 칸 빈 줄, 트레일러 덮임, 훅 사고를 값 없이 수로 센다.
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { appRecord, appRecordText } from '../../scripts/app-record.ts'
import { cleanupAll, makeTempDir, writeFiles } from '../support/repo.ts'

afterAll(cleanupAll)

const ID = '11111111-2222-3333-4444-555555555555'
const line = (over: Record<string, unknown>) =>
  JSON.stringify({
    ts: '2026-11-06T10:00:00.000Z',
    project: '/repo',
    work: ID,
    head: 'a'.repeat(40),
    conclusion: 'human_merge',
    condition: null,
    shadow: false,
    relay_version: '0.0.0',
    met: [],
    conds: { small: 'abc123abc123' },
    gate_version: 1,
    review_prompt: 4,
    model_requested: 'default',
    model_observed: 'm',
    effort: 'high',
    claude_version: '2.1.3',
    relay_build: '14f3303deadbeef',
    ...over,
  })

describe('app-record: (C)의 앱 기록', () => {
  test('판 칸 빈 줄, relay_build, 세션 커밋 덮임, 사고를 센다(뺀 실행은 까닭마다)', async () => {
    const root = await makeTempDir('relay-app-record-')
    const s = join(root, '10-invoice-rounding')
    await writeFiles(root, { 'report.json': '{}\n' })
    const ok = { error: null, outcome: { success: true }, works: [{ id: ID.slice(0, 8) }] }
    await writeFiles(join(s, 'relay3-1'), {
      'run.json': JSON.stringify(ok),
      [`works/${ID.slice(0, 8)}/work.json`]: JSON.stringify({ id: ID }),
      [`works/${ID.slice(0, 8)}/ledger.jsonl`]: [
        line({}),
        line({ effort: undefined, relay_build: 'other' }),
        line({ work: 'someone-else' }),
      ].join('\n'),
      [`works/${ID.slice(0, 8)}/session-commits.jsonl`]: [
        JSON.stringify({ ts: 't', kind: 'launch', trailer: true }),
        JSON.stringify({
          ts: 't',
          kind: 'commits',
          on: true,
          tool: 'Bash',
          commits: [
            { sha: 'c1', trailer: true },
            { sha: 'c2', trailer: false },
          ],
        }),
      ].join('\n'),
      [`works/${ID.slice(0, 8)}/events.jsonl`]: [
        JSON.stringify({ type: 'trailer_missing', commits: ['c2'] }),
        JSON.stringify({ type: 'hook_incident', lines: ['x'] }),
      ].join('\n'),
      [`works/${ID.slice(0, 8)}/hooks.log`]: 'no hooks dir\n',
    })
    await writeFiles(join(s, 'relay3-2'), { 'run.json': JSON.stringify({ ...ok, error: 'x' }) })
    const r = appRecord([root], '14f3303')
    expect(r).toMatchObject({
      runs: 1,
      skipped: { '오류로 끝남': 1 },
      works: 1,
      lines: 2,
      no_epoch: 1,
      empty: { effort: 1, model_observed: 0 },
      epochs: [1],
      build_match: 1,
      model_default: 2,
      session_works: 1,
      launches: 1,
      commits: 2,
      watched: 2,
      trailered: 1,
      trailer_missing: 1,
      hook_incident: 1,
      hooks_log_lines: 1,
      incident_works: [`10-invoice-rounding/relay3-1/${ID.slice(0, 8)}`],
    })
    const text = appRecordText(r)
    expect(text).toContain('판 열쇠가 빈 줄 1 (50%)')
    expect(text).toContain('그 가운데 트레일러 있음 1 (덮임 50%)')
    // 칸의 값(모델 이름 등)은 찍지 않는다
    expect(text).not.toMatch(/high|2\.1\.3|abc123/)
  })
})
