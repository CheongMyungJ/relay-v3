// [스모크] 규칙 승격(M3d, V42). app.spec.ts가 600줄에 닿아 나눴다. 빌드한 앱(out/)을 Playwright _electron으로 띄운다. 기준의
// quality.json rules에 no-console이 있고 지식 규칙 셋(check: no-console로 승격되고 허용 목록에 src/old.js·src/calc.js, check가
// 없는 규칙, rules에 없는 check: no-eval)과 rule_violation 빚(src/calc.js, no-console)이 있다. 가짜 claude가 clamp를 고치며
// 허용 목록에서 calc.js를 빼고 other.js를 더한다. [증거]의 사람에게 보낸 까닭에 '규칙의 허용 목록이 늚', '지식'에 말로만 남은
// 규칙 2개, '빚'에 갚은 빚(console-calc)이 보이고, 설정에 규칙 승격 스위치가 켜져 있다. test-results/smoke-promote-*.png(1400x900).
//   xvfb-run -a npm run test:smoke      (npm 스크립트가 먼저 빌드한다)
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { formatDebt } from '../../src/core/debt.ts'
import type { DebtItem } from '../../src/core/types.ts'
import { calc, QUALITY, TESTS_BASE } from '../support/calc.ts'
import { FAKE_CLAUDE, fakeGhOnPath } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'
import { CONTRACT, FIX_COMMIT } from '../support/works-flow.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'test-results')
const REQUEST = 'clamp fix: 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.'
const CONSOLE = 'docs/knowledge/console.md'

const rule = (title: string, check: string | null, notYet: string[]) =>
  [
    '---',
    'kind: rule',
    'source: human',
    ...(check === null ? [] : [`check: ${check}`]),
    '---',
    `# ${title}`,
    '',
    '## 규칙',
    '',
    `- ${title}`,
    ...(notYet.length === 0
      ? []
      : ['', '## 아직 규칙을 따르지 않는 곳', '', ...notYet.map((p) => `- \`${p}\``)]),
    '',
  ].join('\n')

const violation: DebtItem = {
  id: 'console-calc',
  anchor: { path: 'src/calc.js', metric: 'no-console' },
  kind: 'rule_violation',
  source: 'https://github.com/o/calc/pull/3',
  reason: 'calc.js가 콘솔에 씀',
  created: '2026-10-01',
}

// 가짜 claude는 clamp를 고치며 calc.js를 허용 목록에서 빼고(갚음) other.js를 더한다(허용 목록이 늚)
const SCENARIO = {
  start: [
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    {
      ...FIX_COMMIT,
      files: {
        ...FIX_COMMIT.files,
        [CONSOLE]: rule('콘솔에 쓰지 않는다', 'no-console', ['src/old.js', 'src/other.js']),
      },
    },
    { do: 'stop' },
    { do: 'waitInput' },
  ],
}

let tmp: string
let repo: TestRepo
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-promote-')
  const origin = join(tmp, 'origin.git')
  await runGit(tmp, ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
  repo = await makeRepo({
    files: {
      'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      '.relay/quality.json': `${JSON.stringify({ ...QUALITY, rules: ['no-console'] }, null, 2)}\n`,
      'src/calc.js': calc('lo'),
      'test/calc.test.js': TESTS_BASE,
      [CONSOLE]: rule('콘솔에 쓰지 않는다', 'no-console', ['src/old.js', 'src/calc.js']),
      'docs/knowledge/naming.md': rule('공개 이름은 영어로', null, []),
      'docs/knowledge/eval.md': rule('eval을 쓰지 않는다', 'no-eval', []),
      [`.relay/debt/${violation.id}.md`]: formatDebt(violation),
    },
  })
  await repo.git('remote', 'add', 'origin', origin)
  await repo.git('push', '--quiet', 'origin', 'main')

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
      RELAY_HOME: join(tmp, 'home'),
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
  await page.screenshot({ path: join(SHOTS, `smoke-promote-${n}-${name}.png`) })
}

test('승격된 규칙의 허용 목록이 늘면 사람 머지 사실, 말로만 남은 규칙, rule_violation의 갚음', async () => {
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 Work' }).first().click()
  const dialog = page.getByRole('dialog', { name: '새 Work' })
  await dialog.getByLabel('요청', { exact: true }).fill(REQUEST)
  await dialog.getByRole('button', { name: '만들기' }).click()
  await expect(dialog).toBeHidden()

  const approve = page.getByTestId('approve-box')
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await approve.getByRole('button', { name: '승인', exact: true }).click()

  const evidence = page.getByTestId('evidence-panel')
  await expect(evidence.getByTestId('conclusion')).toHaveText('사람 머지', { timeout: 60_000 })
  await expect(evidence.getByTestId('review-meta')).toHaveText(/^리뷰 끝/, { timeout: 60_000 })
  await expect(evidence).toContainText(
    '규칙의 허용 목록이 늚: docs/knowledge/console.md (검사 `no-console`의 허용 목록',
  )
  await evidence.locator('summary', { hasText: /^지식/ }).click()
  await expect(evidence.getByTestId('knowledge-summary')).toHaveText(
    '바뀐 지식 파일 1개 · 말로만 남은 규칙 2개',
  )
  await expect(evidence.getByTestId('knowledge-spoken')).toContainText('docs/knowledge/naming.md')
  await expect(evidence.getByTestId('knowledge-spoken')).toContainText(
    '검사 `no-eval`가 quality.json rules에 없음',
  )
  await evidence.locator('summary', { hasText: /^빚/ }).click()
  await expect(evidence.getByTestId('tidy-paid')).toContainText(
    '`src/calc.js`가 허용 목록에서 빠지고 빠른 명령이 통과',
  )
  await evidence.getByTestId('tidy-paid').scrollIntoViewIfNeeded()
  await shot('evidence')

  // 설정: 규칙 승격 스위치(켬)
  await page.getByRole('button', { name: /설정$/ }).first().click()
  const settings = page.getByRole('dialog')
  const toggle = settings.getByRole('switch', { name: /^규칙 승격/ })
  await expect(toggle).toBeChecked()
  await toggle.scrollIntoViewIfNeeded()
  await shot('settings')
})
