// [스모크] 설정 대화상자의 [실적](M4c, docs/m4-design.md 5.2, RecordTable.tsx). 장부(RELAY_HOME/ledger.jsonl)에 조건 small의 그림자
// 결론과 끝(일치 둘, 더 커밋한 머지 하나, 닫힘 하나, 열림 하나), 사람 경로의 머지, 판이 바뀐 줄, 머지 뒤 30일의 되돌림(after)을
// 미리 적고 앱을 띄운다. 조건 줄(일치 k/n과 하한, 불일치 갈래, 분모 밖, 머지 뒤, 비교군과 lift), 사람 경로 줄, 판이 바뀐 자리, 깨진
// 줄 수가 보이고, '모든 판'으로 바꾸면 앞 판의 표본도 센다. 진행 막대나 'M5까지'는 없다. [귀속이 틀림]은 dispute 줄을 쓰고 그
// 사건을 셈에서 뺀다. test-results/smoke-record-*.png(1400x900).
//   xvfb-run -a npm run test:smoke      (npm 스크립트가 먼저 빌드한다)
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { repoKey } from '../../src/adapters/store.ts'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import { QUALITY_TEXT } from '../support/calc.ts'
import { FAKE_CLAUDE, fakeGhOnPath } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'test-results')

let tmp: string
let home: string
let repo: TestRepo
let app: ElectronApplication
let page: Page

const DAY = 24 * 60 * 60 * 1000
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const M = 'a'.repeat(40)

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-record-')
  repo = await makeRepo({ files: { '.relay/quality.json': QUALITY_TEXT, 'a.txt': 'a\n' } })
  home = join(tmp, 'home')
  await mkdir(home, { recursive: true })
  const project = repoKey(repo.dir)
  const epoch = {
    conds: { small: 'a1b2c3d4e5f6' },
    model_observed: 'claude-model-x',
    effort: 'medium',
    claude_version: '2.4.1 (Claude Code)',
    gate_version: GATE_VERSION,
    review_prompt: 4,
    relay_version: '0.0.0',
  }
  const line = (work: string, met: string[], more: object = {}) => ({
    ts: ago(3),
    project,
    work,
    head: `${work}-h`.padEnd(40, '0'),
    conclusion: 'human_merge',
    condition: met[0] ?? null,
    shadow: met.length > 0,
    met,
    ...epoch,
    ...more,
  })
  const end = (work: string, more: object) => ({
    ...line(work, []),
    condition: null,
    shadow: false,
    met: undefined,
    ...more,
  })
  const merged = (work: string, more: object = {}) =>
    end(work, { merged_head: line(work, []).head, by: 'human', same_change: true, ...more })
  const lines = [
    line('w0', ['small'], { claude_version: '2.3.9 (Claude Code)', ts: ago(9) }),
    merged('w0'),
    line('w1', ['small']),
    merged('w1', {
      merge_commit: M,
      merged_at: ago(2),
      after_commits: { session: 0, human: 0, relay: 0, base_update: 0, disagree: 0 },
      session_set: { commits: 1, watched: 1, trailered: 1, incidents: 0 },
    }),
    line('w2', ['small']),
    merged('w2'),
    line('w3', ['small']),
    // M4e: 사람이 더 커밋해 머지함(세션 커밋 가르기)
    merged('w3', {
      merged_head: 'b'.repeat(40),
      same_change: false,
      after_commits: { session: 0, human: 1, relay: 0, base_update: 0, disagree: 0 },
      session_set: { commits: 2, watched: 2, trailered: 2, incidents: 0 },
    }),
    line('w4', ['small']),
    end('w4', { closed: true }),
    line('w5', ['small']),
    line('w6', []),
    merged('w6'),
    line('w7', []),
    merged('w7', { merged_head: 'c'.repeat(40), same_change: false }),
  ]
  const after = {
    kind: 'after',
    ts: ago(1),
    project,
    work: 'w1',
    merge_commit: M,
    merged_at: ago(2),
    window_end: new Date(Date.now() + 28 * DAY).toISOString(),
    closed: false,
    revert: { sha: 'd'.repeat(40), form: 'this_reverts' },
    main: 'clean',
    seen_until: ago(1),
  }
  const text = [...lines, after].map((l) => JSON.stringify(l)).join('\n')
  await appendFile(join(home, 'ledger.jsonl'), `${text}\n{깨진 줄\n`)
  const ghState = join(tmp, 'gh-state.json')
  await writeFile(ghState, '{}')
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: {
      ...(process.env as Record<string, string>),
      ...(await fakeGhOnPath(tmp)),
      RELAY_HOME: home,
      CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_GH_STATE: ghState,
      FAKE_GH_LOG: join(tmp, 'gh.jsonl'),
    },
  })
  await app.evaluate(({ dialog }, d) => {
    const pick = async () => ({ canceled: false, filePaths: [d] })
    Object.assign(dialog, { showOpenDialog: pick })
  }, repo.dir)
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900)
  })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await cleanupAll()
})

let shots = 0
async function shot(name: string): Promise<void> {
  await page.waitForTimeout(250)
  const n = String(++shots).padStart(2, '0')
  await page.screenshot({ path: join(SHOTS, `smoke-record-${n}-${name}.png`) })
}

test('[실적]: 조건 줄, 사람 경로 줄, 판, 모든 판, [귀속이 틀림]', async () => {
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await page.getByRole('button', { name: /설정$/ }).first().click()
  const record = page.getByRole('dialog').getByTestId('record')
  const small = record.getByTestId('record-condition')
  // 지금 판(Claude Code 2.4): w0은 앞 판이라 판 다름
  await expect(small).toContainText('small (a1b2c3) · 일치 2/4 (하한 0.15)')
  await expect(small).toContainText('불일치: 사람이 더 고침 1, 닫음 1')
  await expect(small).toContainText('분모 밖: 열림 1, 판 다름 1')
  await expect(small).toContainText(
    '머지 뒤(창 닫힘 0, 지켜보는 중 3): 되돌림 1, main 실패 귀속 0, 미정 0',
  )
  await expect(small).toContainText('비교군(이 조건을 못 채움): 그대로 머지 1/2')
  await expect(small).toContainText('lift +0.00')
  await expect(record.getByTestId('record-human')).toContainText('그대로 머지 1/2')
  await expect(record.getByTestId('record-epoch')).toHaveText(
    '이 판: 모델 claude-model-x, effort medium, Claude Code 2.4, 관문 판 1, 리뷰 프롬프트 4',
  )
  await expect(record).toContainText('판이 바뀜: Claude Code 2.3 → 2.4')
  await expect(record.getByTestId('record-foot')).toHaveText(
    '판을 모르는 결론 줄 0/8 · 읽지 못한 장부 줄 1',
  )
  // 세션 커밋 가르기(M4e)의 지표와 트레일러 스위치(기본 켬)
  await expect(record.getByTestId('record-sessions')).toHaveText(
    '세션 커밋 · 내보낸 뒤 사람 교정 1/2 · 내보낸 뒤 커밋: 사람 1 · 집합과 트레일러가 다름 0 · 트레일러 덮임 3/3 (Work 2) · 훅 위임 사고 0',
  )
  await expect(
    page.getByRole('dialog').getByRole('switch', { name: /세션 커밋 트레일러/ }),
  ).toBeChecked()
  await expect(record).not.toContainText('M5')
  await expect(page.getByRole('dialog').locator('progress')).toHaveCount(0)
  await page.getByRole('dialog').getByText('세션 커밋 트레일러').scrollIntoViewIfNeeded()
  await shot('trailer-switch')
  await record.scrollIntoViewIfNeeded()
  await shot('current')

  await record.getByRole('button', { name: '모든 판' }).click()
  await expect(small).toContainText('small (a1b2c3) · 일치 3/5')
  await expect(record.getByTestId('record-epoch')).toHaveText('모든 판')

  // [귀속이 틀림]: 장부에 dispute 줄, 그 되돌림은 셈에서 빠진 채 보인다
  const ev = record.getByTestId('record-event')
  await expect(ev).toContainText(`되돌림 · 머지 ${M.slice(0, 7)} · 커밋 ddddddd`)
  await ev.getByRole('button', { name: '귀속이 틀림' }).click()
  await expect(ev).toContainText('이의로 셈에서 뺌')
  await expect(small).toContainText('되돌림 0, main 실패 귀속 0, 미정 0')
  await expect(small).toContainText('이의로 뺌 1')
  const ledger = await readFile(join(home, 'ledger.jsonl'), 'utf8')
  expect(ledger).toContain(`"kind":"dispute"`)
  await record.scrollIntoViewIfNeeded()
  await shot('disputed')
})
