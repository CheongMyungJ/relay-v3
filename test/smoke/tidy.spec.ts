// [스모크] 곁들일 정리(M3c, V41). app.spec.ts가 600줄에 닿아 나눴다. 빌드한 앱(out/)을 Playwright _electron으로 띄운다. 기준에
// 빚 넷(받아들인 나빠짐 src/big.js, 정리 src/calc.js, 규칙 어김 src/calc.js, 시험 빈틈 src/other.js)이 있고, 가짜 claude의 계약이
// 앞의 둘을 tidy로 집어 big.js를 600줄 아래로 줄이고(정리 항목 파일은 지우지 않음) clamp를 고친다. [증거]의 '빚'에 정리 몫이
// 상한(quality.json tidy_max_lines 20)을 넘었다는 알림, 갚은 빚(big), 못 갚은 빚(calc-names), 건드린 곳의 빚(calc-rule)이 보이고
// 관문 사실이 아니다. 승인 전 [계약]의 곁들일 정리에 id마다 기준 장부의 종류·경로·까닭이 보인다. 설정에 곁들일 정리 스위치가
// 켜져 있다. test-results/smoke-tidy-*.png(1400x900).
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
const big = (n: number) => 'export const x = 1\n'.repeat(n)

const debt = (id: string, o: Partial<DebtItem>): [string, string] => [
  `.relay/debt/${id}.md`,
  formatDebt({
    id,
    anchor: { path: 'src/calc.js' },
    kind: 'tidy',
    source: 'https://github.com/o/calc/pull/3',
    reason: `${id}의 까닭`,
    created: '2026-10-01',
    ...o,
  }),
]

const SCENARIO = {
  start: [
    {
      do: 'mcp',
      tool: 'submit_contract',
      args: { ...CONTRACT, tidy: ['big', 'calc-names'] },
    },
    { ...FIX_COMMIT, files: { ...FIX_COMMIT.files, 'src/big.js': big(590) } },
    { do: 'stop' },
    { do: 'waitInput' },
  ],
}

let tmp: string
let repo: TestRepo
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-tidy-')
  const origin = join(tmp, 'origin.git')
  await runGit(tmp, ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
  repo = await makeRepo({
    files: {
      'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      '.relay/quality.json': `${JSON.stringify({ ...QUALITY, tidy_max_lines: 20 }, null, 2)}\n`,
      'src/calc.js': calc('lo'),
      'src/big.js': big(700),
      'test/calc.test.js': TESTS_BASE,
      ...Object.fromEntries([
        debt('big', {
          kind: 'accepted_regression',
          anchor: { path: 'src/big.js', metric: 'file-size' },
          reason: '래칫 file-size: 나빠진 채로 머지됨 (src/big.js 500 → 700)',
          created: '2026-09-01',
        }),
        debt('calc-names', { reason: 'clamp의 매개변수 이름이 한 글자' }),
        debt('calc-rule', { kind: 'rule_violation', reason: '계산 함수가 로그를 남기지 않음' }),
        debt('other-gap', { kind: 'test_gap', anchor: { path: 'src/other.js' } }),
      ]),
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
  await page.screenshot({ path: join(SHOTS, `smoke-tidy-${n}-${name}.png`) })
}

test('계약의 곁들일 정리 → [증거]의 빚: 상한 넘음, 갚은 빚, 못 갚은 빚, 건드린 곳의 빚', async () => {
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await page.getByRole('button', { name: '새 Work', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '새 Work' })
  await dialog.getByLabel('요청', { exact: true }).fill(REQUEST)
  await dialog.getByRole('button', { name: '만들기' }).click()
  await expect(dialog).toBeHidden()

  // [계약]의 곁들일 정리(빚)
  const approve = page.getByTestId('approve-box')
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('곁들일 정리(빚)')).toBeVisible()
  // id마다 기준 장부의 종류·경로·까닭(사람이 무엇을 받는지 알고 승인)
  const taken = page.getByTestId('contract-tidy')
  await expect(taken).toContainText('big · 받아들인 나빠짐 · src/big.js: 래칫 file-size')
  await expect(taken).toContainText(
    'calc-names · 정리 · src/calc.js: clamp의 매개변수 이름이 한 글자',
  )
  await taken.scrollIntoViewIfNeeded()
  await shot('contract')
  await approve.getByRole('button', { name: '승인', exact: true }).click()

  const evidence = page.getByTestId('evidence-panel')
  await expect(evidence.getByTestId('conclusion')).toHaveText('사람 머지', { timeout: 60_000 })
  await expect(evidence.getByTestId('review-meta')).toHaveText(/^리뷰 끝/, { timeout: 60_000 })
  await evidence.getByRole('button', { name: /^빚/ }).click()
  await expect(evidence.getByTestId('tidy-lines')).toHaveText(
    '상한 넘음곁들일 정리 2개 · 정리 몫 112줄 (상한 20줄을 넘음)',
  )
  await expect(evidence.getByTestId('tidy-paid')).toContainText('590줄 ≤ 600')
  await expect(evidence.getByTestId('tidy-unpaid')).toContainText('calc-names · 항목 파일이 남음')
  await expect(evidence.getByTestId('tidy-touched')).toContainText('calc-rule')
  await expect(evidence.getByTestId('tidy-touched')).not.toContainText('other-gap')
  await evidence.getByTestId('tidy-touched').scrollIntoViewIfNeeded()
  await shot('evidence')

  // 설정: 곁들일 정리 스위치(켬)
  await page.getByRole('button', { name: /설정$/ }).first().click()
  const settings = page.getByRole('dialog')
  await expect(settings.getByRole('switch', { name: /^곁들일 정리/ })).toBeChecked()
  await shot('settings')
})
