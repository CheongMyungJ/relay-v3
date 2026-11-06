// [스모크] 받아들인 나빠짐의 빚 기록(M3b, V40). app.spec.ts가 600줄에 닿아 나눴다. 빌드한 앱(out/)을 Playwright _electron으로
// 띄운다. 장부에 앱 밖에서 머지된 나빠짐이 있어 새 Work의 [계약] 맨 위에 '기록 안 된 나빠짐'이 보이고, 가짜 claude가 600줄을
// 넘는 파일을 커밋하고 PR을 열면 [머지]가 빚 확인을 한 번 묻는다: [빚으로 남기고 머지] → relay가 빚을 커밋·push하고 머지한다.
// 설정에 빚 기록 스위치가 켜져 있다. test-results/smoke-debt-*.png(1400x900).
//   xvfb-run -a npm run test:smoke      (npm 스크립트가 먼저 빌드한다)
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { repoKey } from '../../src/adapters/store.ts'
import { calc, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { FAKE_CLAUDE, fakeGhOnPath } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'
import { CONTRACT, FIX_COMMIT, PUSH_AND_PR } from '../support/works-flow.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'test-results')
const REQUEST = 'clamp fix: 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.'

const SCENARIO = {
  start: [
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    {
      ...FIX_COMMIT,
      files: { ...FIX_COMMIT.files, 'src/big.js': 'export const x = 1\n'.repeat(700) },
    },
    ...PUSH_AND_PR,
    { do: 'stop' },
    { do: 'waitInput' },
  ],
}

let tmp: string
let repo: TestRepo
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-debt-')
  const origin = join(tmp, 'origin.git')
  await runGit(tmp, ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
  repo = await makeRepo({
    files: {
      'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      '.relay/quality.json': QUALITY_TEXT,
      'src/calc.js': calc('lo'),
      'test/calc.test.js': TESTS_BASE,
    },
  })
  await repo.git('remote', 'add', 'origin', origin)
  await repo.git('push', '--quiet', 'origin', 'main')

  // 장부: 앞 Work의 내보내기가 시험 수 래칫이 나빠진 채 앱 밖에서 머지됐다
  const home = join(tmp, 'home')
  await mkdir(home, { recursive: true })
  const line = {
    ts: '2026-11-05T00:00:00Z',
    project: repoKey(repo.dir),
    work: 'w0',
    head: 'f'.repeat(40),
    conclusion: 'human_merge',
    condition: null,
    shadow: false,
    relay_version: '0.0.0',
  }
  const worse = [{ id: 'tests', status: 'worse', base: 3, head: 2, detail: '시험 수 3 → 2' }]
  const merged = { by: 'human-override', merged_head: line.head }
  const text = [
    { ...line, worse },
    { ...line, ...merged },
  ].map((l) => JSON.stringify(l))
  await appendFile(join(home, 'ledger.jsonl'), `${text.join('\n')}\n`)

  const scenario = join(tmp, 'scenario.json')
  await writeFile(scenario, JSON.stringify(SCENARIO))
  const review = join(tmp, 'review.json')
  await writeFile(review, JSON.stringify({ findings: [] }))
  const ghState = join(tmp, 'gh-state.json')
  await writeFile(ghState, '{}')
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: {
      ...(process.env as Record<string, string>),
      ...(await fakeGhOnPath(tmp)),
      RELAY_HOME: home,
      CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_SCENARIO: scenario,
      FAKE_CLAUDE_LOG: join(tmp, 'claude.jsonl'),
      FAKE_CLAUDE_REVIEW: review,
      FAKE_GH_STATE: ghState,
      FAKE_GH_LOG: join(tmp, 'gh.jsonl'),
      RELAY_DEBOUNCE_MS: '300',
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
  await page.screenshot({ path: join(SHOTS, `smoke-debt-${n}-${name}.png`) })
}

test('기록 안 된 나빠짐 알림 → 나빠진 래칫의 [머지]가 빚을 묻는다 → [빚으로 남기고 머지]', async () => {
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 Work' }).first().click()
  const dialog = page.getByRole('dialog', { name: '새 Work' })
  await dialog.getByLabel('요청', { exact: true }).fill(REQUEST)
  await dialog.getByRole('button', { name: '만들기' }).click()
  await expect(dialog).toBeHidden()

  // [계약] 맨 위: 앱 밖에서 머지된 나빠짐(세션에게는 request.md 끝)
  const unrecorded = page.getByTestId('unrecorded')
  await expect(unrecorded).toBeVisible({ timeout: 30_000 })
  await expect(unrecorded).toContainText('tests: 시험 수 3 → 2 (앱 밖에서 머지됨)')
  await expect(page.getByTestId('approve-box')).toBeVisible({ timeout: 30_000 })
  await shot('unrecorded')
  await page.getByTestId('approve-box').getByRole('button', { name: '승인', exact: true }).click()

  // PR 내보내기: 래칫 file-size가 나빠져 사람 머지
  const evidence = page.getByTestId('evidence-panel')
  await expect(evidence.getByRole('link', { name: '#1' })).toBeVisible({ timeout: 60_000 })
  await expect(evidence.getByTestId('conclusion')).toHaveText('사람 머지', { timeout: 60_000 })
  await expect(evidence.getByTestId('review-meta')).toHaveText(/^리뷰 끝/, { timeout: 60_000 })
  const merge = evidence.getByRole('button', { name: '머지', exact: true })
  await expect(merge).toBeEnabled()
  await merge.click()
  const ask = evidence.getByTestId('debt-ask')
  await expect(ask).toContainText('래칫 file-size (600줄을 넘음: src/big.js(700))가 나빠졌습니다')
  await expect(ask.getByRole('button', { name: '그냥 머지' })).toBeVisible()
  await ask.scrollIntoViewIfNeeded()
  await shot('ask')
  await ask.getByRole('button', { name: '빚으로 남기고 머지' }).click()
  await expect(page.locator('.work-head')).toContainText('끝남', { timeout: 30_000 })
  await expect(evidence.getByTestId('outcome')).toHaveText(/^머지됨 · PR #1/)
  await expect(evidence.getByTestId('debt-ask')).toHaveCount(0)
  await expect(evidence.getByTestId('debt-commit')).toHaveText(/^빚 기록 커밋\(잰 [0-9a-f]{7}\)$/)
  await shot('merged')

  // 설정: 빚 기록 스위치(켬)
  await page.getByRole('button', { name: /설정$/ }).first().click()
  const settings = page.getByRole('dialog')
  await expect(settings.getByRole('switch', { name: /^빚 기록/ })).toBeChecked()
  await shot('settings')
})
