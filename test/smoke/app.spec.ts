// [스모크] 빌드한 앱 (docs/m2-modules.md 5절). Playwright _electron으로 out/의 앱을 띄워 화면을 누른다.
// 가짜 claude(CLAUDE_BIN)가 계약을 내고 커밋하고 쉬면 미리 리뷰(V23)가 돌고, PR을 열면 그 리뷰로 내보낸다. 가짜 gh, 임시
// RELAY_HOME, 임시 git 레포와 bare origin.
// 둘째 프로젝트는 품질 기준이 없는 레포다: 알림과 [초안 만들기](V20), PR 없이 [끝내기] → 걸린 끝 → 열린 것의 상자(다른
// Work로 갔다 와도 남음) → [그래도 끝내기](V25).
// 첫 계약에는 승인 상자의 글 칸에 바로 써서 [보내기]로 고쳐 달라고 하고(M2.1 13절), [변경]은 작은 diff라 펼친 채로 열린다.
// 계약의 비목표는 목표 바로 밑에(V29), 줄은 단위마다 묶여 보인다(V21). 세션이 시험을 먼저 커밋하고 내도 제출 때 기준에서 돌리지 않는다(V32: V28을 뺌). 리뷰의 구조/low 지적은 메모라 그림자와 [끝내기]를 막지 않는다(V26).
// 메모는 쉬는 세션에 저절로 가지 않고, 사람이 [세션에 넘기기]로 보낸다(V24). 상자에도 올림을 넘기는 단추가 있고, 사람 몫의
// 올림(계약 밖 변경)이 남아 있으면 세션 몫(구조/중간)도 저절로 가지 않고 넘길 수 있다. 상자의 넘기기는 끝을 다시 건다(V35).
// 끝으로 첫 프로젝트에 단위 브랜치로 내보내는 Work(V22): 통합 증거 칸과 내보내기마다 칸, 없는 단위 브랜치는 상자의 열린 것.
// 폴더 고르기 대화상자는 메인에서 바꿔 끼운다. 단계마다 test-results/smoke-*.png(1400x900)를 남긴다.
//
//   xvfb-run -a npm run test:smoke      (npm 스크립트가 먼저 빌드한다)
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { calc, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { FAKE_CLAUDE, fakeGhOnPath } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'test-results')
const REQUEST = 'clamp fix: 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.'

// 계약 id는 지침이 준 것(작업 브랜치 relay/<계약 id>). 가짜 claude가 {contractId}를 채운다
const CONTRACT = {
  version: 1,
  id: '{contractId}',
  goal: 'clamp가 hi보다 큰 값을 hi로 자른다',
  lines: [
    {
      id: 'C1',
      kind: 'change',
      text: 'hi보다 큰 값은 hi가 된다',
      grounds: [
        { type: 'code', path: 'src/calc.js', line: 5, name: 'clamp' },
        { type: 'request', quote: '위로 넘으면 hi로' },
      ],
      examples: ['C1.1'],
      check: 'test',
      // 단위(V21): 계약 판이 단위마다 줄을 묶는다. C2는 모든 단위에 걸친다
      unit: 'clamp',
    },
    {
      id: 'C2',
      kind: 'keep',
      text: '더하기는 그대로',
      grounds: [{ type: 'guess' }],
      examples: ['C2.1'],
      check: 'test',
    },
  ],
  examples: [
    { id: 'C1.1', input: [15, 0, 10], output: 10 },
    { id: 'C2.1', input: [2, 3], output: 5 },
  ],
  non_goals: ['clamp의 인자 순서는 바꾸지 않는다'],
  human_rules: [],
  tidy: [],
}

const TESTS_FIXED = `${TESTS_BASE}
import { readFileSync } from 'node:fs'
const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/{contractId}.json', import.meta.url), 'utf8'),
)

test('더하기는 그대로 [{contractId}:C2.1]', () => {
  assert.equal(add(2, 3), 5)
})

test('위로 넘는 값은 hi로 [{contractId}:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(clamp(...input), output)
})
`

const SCENARIO = {
  start: [
    { do: 'print', text: '요청과 코드를 읽었습니다. 계약을 냅니다.' },
    // 시험을 먼저 커밋해도 된다(지침 §1). 제출 때 기준에서 돌리지 않는다(V32)
    { do: 'commit', message: '시험 먼저', files: { 'test/calc.test.js': TESTS_FIXED } },
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    // 첫 프로젝트는 고쳐 달라고 하므로(답 changes) 다시 낸다. 둘째 프로젝트는 승인했으므로 같은 계약의 승인을 돌려받는다
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    { do: 'print', text: '승인됨. clamp를 고칩니다.' },
    {
      do: 'commit',
      message: 'clamp 고침',
      files: {
        'src/calc.js': calc('hi'),
        // 예시 자료는 앱이 승인 때 worktree에 쓴 것을 함께 커밋한다(V27)
        'test/calc.test.js': TESTS_FIXED,
      },
    },
    { do: 'print', text: '커밋했습니다. PR을 열까요? (Enter)' },
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'sleep', ms: 2000 }, // 둘째 Work의 넘긴 끝(V35)을 찍을 틈
    { do: 'bash', command: 'git push -u origin HEAD' },
    { do: 'bash', command: 'gh pr create --title "clamp 고침" --body b --base main' },
    { do: 'print', text: 'PR을 열었습니다.' },
    { do: 'stop' },
  ],
}

/** 단위 브랜치(V22)의 시나리오: Work 브랜치에 두 단위(clamp 고침, sub 새로)를 두고 clamp 단위 브랜치만 만든 채 쉰다 */
const sub = (fn: string, from: string, id: string) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ${fn} } from '../src/${from}.js'
const x = JSON.parse(readFileSync(new URL('../.relay/examples/{contractId}.json', import.meta.url), 'utf8'))['${id}']
test('${fn} [{contractId}:${id}]', () => assert.equal(${fn}(...x.input), x.output))
`
const UNITS = {
  start: [
    {
      do: 'mcp',
      tool: 'submit_contract',
      args: {
        ...CONTRACT,
        delivery: 'branch_per_unit',
        lines: [
          CONTRACT.lines[0],
          { ...CONTRACT.lines[1], kind: 'new', text: 'sub(a, b)는 a - b', unit: 'sub' },
        ],
        examples: [CONTRACT.examples[0], { id: 'C2.1', input: [5, 3], output: 2 }],
        non_goals: [],
      },
    },
    {
      do: 'commit',
      message: 'clamp',
      files: { 'src/calc.js': calc('hi'), 'test/c.test.js': sub('clamp', 'calc', 'C1.1') },
    },
    {
      do: 'commit',
      message: 'sub',
      files: {
        'src/sub.js': 'export const sub = (a, b) => a - b\n',
        'test/s.test.js': sub('sub', 'sub', 'C2.1'),
      },
    },
    { do: 'bash', command: 'git branch {branch}--clamp HEAD~1' },
    { do: 'stop' },
  ],
}

/** 가짜 리뷰어의 지적: 둘 다 메모다(V26: 갈래가 없는 지적, 구조/low). 관문 사실이 아니라 그림자를 막지 않는다 */
const NOTES = [
  { severity: 'low', text: '변수 이름이 짧음', file: 'src/calc.js', line: 5 },
  { severity: 'low', raise: 'structure', text: '빈 입력 시험이 없음', file: 'src/calc.js' },
]

let tmp: string
let repo: TestRepo
/** 품질 기준이 없는 레포(origin 없음) */
let bare: TestRepo
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-')
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
  bare = await makeRepo({
    files: {
      'package.json': '{ "name": "calc2", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      'src/calc.js': calc('lo'),
      'test/calc.test.js': TESTS_BASE,
    },
  })

  const scenario = join(tmp, 'scenario.json')
  await writeFile(scenario, JSON.stringify(SCENARIO))
  const review = join(tmp, 'review.json')
  await writeFile(review, JSON.stringify({ findings: NOTES }))
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
      // 미리 리뷰(V23)와 [끝내기]의 걸린 끝(V25)이 보일 틈
      FAKE_CLAUDE_REVIEW_MS: '1500',
      FAKE_GH_STATE: ghState,
      FAKE_GH_LOG: join(tmp, 'gh.jsonl'),
      RELAY_DEBOUNCE_MS: '300',
    },
  })
  await pickFolder(repo.dir)
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

/** 폴더 고르기 대화상자를 바꿔 끼운다(ipc.ts는 부를 때마다 dialog.showOpenDialog를 찾는다) */
async function pickFolder(dir: string): Promise<void> {
  await app.evaluate(({ dialog }, d) => {
    const pick = async () => ({ canceled: false, filePaths: [d] })
    Object.assign(dialog, { showOpenDialog: pick })
  }, dir)
}

/** 가짜 claude가 터미널에서 받은 줄(차례대로) */
async function inputs(): Promise<string[]> {
  const text = await readFile(join(tmp, 'claude.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string })
    .filter((e) => e.type === 'input')
    .map((e) => e.text ?? '')
}

/** 가짜 claude가 받은 submit_contract의 답(차례대로) */
async function submitted(): Promise<unknown[]> {
  const text = await readFile(join(tmp, 'claude.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; tool?: string; result?: unknown })
    .filter((e) => e.type === 'mcp' && e.tool === 'submit_contract')
    .map((e) => e.result)
}

let shots = 0
async function shot(name: string): Promise<void> {
  // 그리기(글꼴, 애니메이션)가 가라앉을 틈
  await page.waitForTimeout(250)
  const n = String(++shots).padStart(2, '0')
  await page.screenshot({ path: join(SHOTS, `smoke-${n}-${name}.png`) })
}

test('새 Work → 계약 제출 → [승인] → 증거 결론 → PR과 리뷰(그림자) → [머지]', async () => {
  // 빈 화면 → 프로젝트 추가
  await expect(page.getByText('프로젝트를 추가하세요')).toBeVisible()
  expect(await page.evaluate('[innerWidth, innerHeight]')).toEqual([1400, 900])
  await shot('start')
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await expect(page.getByTestId('project')).toContainText(repo.dir.split('/').at(-1) ?? '')

  // 새 Work 대화상자
  await page.getByRole('button', { name: '+ 새 Work' }).first().click()
  const dialog = page.getByRole('dialog', { name: '새 Work' })
  await dialog.getByLabel('요청', { exact: true }).fill(REQUEST)
  await dialog.getByRole('button', { name: '버그 고침' }).click()
  await expect(dialog.getByLabel('기준 브랜치')).toHaveValue('main')
  await shot('new-work')
  await dialog.getByRole('button', { name: '만들기' }).click()
  await expect(dialog).toBeHidden()

  // 세션이 계약을 낸다 → [계약] 패널에 줄과 근거 확인, [승인]
  const approve = page.getByTestId('approve-box')
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('terminal')).toContainText('FAKE-CLAUDE READY')
  const panel = page.getByTestId('contract-panel')
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(CONTRACT.goal)
  // 비목표는 목표 바로 밑, 줄보다 먼저(V29)
  const firstSection = panel.getByRole('heading', { level: 3 }).first()
  await expect(firstSection).toHaveText('비목표')
  await expect(panel.locator('h2.goal + h3 + ul')).toHaveText(CONTRACT.non_goals[0] ?? '')
  await expect(panel.getByTestId('contract-line')).toHaveCount(2)
  await expect(panel.getByTestId('contract-line').first()).toContainText('확인됨')
  await expect(panel.getByTestId('contract-line').nth(1)).toContainText('추정')
  const groups = panel.getByTestId('unit-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.first().getByRole('heading')).toHaveText('단위 clamp · 줄 1개')
  await expect(groups.nth(1).getByRole('heading')).toHaveText('모든 단위에 걸친 줄 · 줄 1개')
  await expect(panel.getByTestId('delivery')).toContainText('한 브랜치: 모든 단위를 relay/')
  // 제출 때 기준 확인은 뺐다(V32): 계약 판에 기준 결과의 한 줄과 꼬리표가 없다
  await expect(panel).not.toContainText('제출 때 기준')
  await expect(panel).not.toContainText('기준에서 실패')
  await groups.nth(1).scrollIntoViewIfNeeded()
  await shot('contract-units')
  await panel.evaluate((el) => el.scrollTo(0, 0))
  await shot('contract')
  // 고쳐 달라기(M2.1 13절): 여는 단추 없이 글 칸에 쓰고 [보내기]. 세션은 changes 답을 받고 계약을 다시 낸다(가짜 claude는
  // 답을 받은 호출만 기록한다)
  const send = approve.getByRole('button', { name: '보내기', exact: true })
  await expect(send).toBeDisabled()
  await approve.getByLabel('고칠 점').fill('C2의 근거를 코드에서 찾아 주세요')
  await shot('ask-changes')
  await send.click()
  await expect
    .poll(async () => (await submitted()).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1)
  expect((await submitted())[0]).toEqual({
    status: 'changes',
    message: 'C2의 근거를 코드에서 찾아 주세요',
  })
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await expect(approve.getByLabel('고칠 점')).toHaveValue('')
  await approve.getByRole('button', { name: '승인', exact: true }).click()

  // 승인 → 커밋·Stop → 증거: [증거] 탭으로 옮겨 결론을 크게. 세션이 쉬고 명령·줄이 통과했으니 미리 리뷰(V23)가 돈다
  const evidence = page.getByTestId('evidence-panel')
  await expect(evidence).toBeVisible({ timeout: 30_000 })
  await expect(evidence.getByTestId('conclusion')).toHaveText('사람 머지', { timeout: 60_000 })
  await expect(evidence.getByRole('status').filter({ hasText: '리뷰 도는 중…' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(evidence.getByTestId('decisive')).toHaveText(/^리뷰 도는 중: 리뷰가 끝나면/)
  await shot('prepared-review')
  // 미리 리뷰가 끝나면 이 head의 리뷰로 결론을 다시 정한다: 자동 머지가 꺼져 있어 그림자. 장부에는 쓰지 않는다(내보내기 아님)
  await expect(evidence.getByTestId('review-meta')).toHaveText('리뷰 끝(이 head): 지적 2개', {
    timeout: 60_000,
  })
  await expect(evidence.getByText(/^그림자: 자동이었으면 머지했을 것/)).toBeVisible()
  await expect(evidence.getByTestId('decisive')).toHaveText('프로젝트에서 자동 머지가 꺼져 있음')
  // PR이 없으면 다음 할 일을 말한다
  await expect(evidence.getByTestId('next-step')).toContainText('PR이 열리면')
  await expect(evidence.getByText('줄 판정')).toBeVisible()
  await shot('evidence')

  // 터미널에서 Enter → 세션이 push하고 PR을 연다 → 내보내기 증거(미리 리뷰를 다시 쓴다), 그림자
  await page.getByTestId('terminal').click()
  await page.keyboard.type('go')
  await page.keyboard.press('Enter')
  await expect(evidence.getByRole('link', { name: '#1' })).toBeVisible({ timeout: 60_000 })
  await expect(evidence.getByText(/^그림자: 자동이었으면 머지했을 것/)).toBeVisible()
  await expect(evidence.getByTestId('decisive')).toHaveText('프로젝트에서 자동 머지가 꺼져 있음')
  await expect(evidence.getByTestId('next-step')).toBeHidden()
  // 리뷰 지적은 올림과 메모로 나뉜다(V26): 둘 다 메모라 올림 묶음이 없고, 구조/low에는 갈래를 붙인다
  await evidence.locator('summary', { hasText: '리뷰 지적' }).click()
  const notes = evidence.getByTestId('review-notes')
  await expect(notes).toContainText('메모 2 · 관문에 들어가지 않습니다')
  await expect(notes.getByText('변수 이름이 짧음')).toBeVisible()
  await expect(notes.locator('li', { hasText: '빈 입력 시험이 없음' })).toContainText('구조')
  await expect(evidence.getByTestId('review-raised')).toHaveCount(0)
  const merge = evidence.getByRole('button', { name: '머지', exact: true })
  await expect(merge).toBeEnabled()
  // 메모는 사람 몫이다(V24): 저절로 보내지 않았고 지적마다 [세션에 넘기기]
  await expect(notes.getByRole('button', { name: '세션에 넘기기' })).toHaveCount(2)
  await expect(evidence.getByTestId('feedback-status')).toHaveCount(0)
  await shot('shadow')
  // [세션에 넘기기]: 되먹임 파일을 쓰고 터미널에 한 줄. 상태 줄과 지적의 표시가 바뀐다(라운드로 세지 않음)
  const short = notes.getByTestId('finding').filter({ hasText: '변수 이름이 짧음' })
  await short.getByRole('button', { name: '세션에 넘기기' }).click()
  await expect(evidence.getByTestId('feedback-status')).toHaveText(
    '사람이 세션에 넘김 · 되먹임 1: 리뷰 지적 1개',
  )
  await expect(short).toContainText('세션에 보냄')
  await expect(short.getByRole('button', { name: '세션에 넘기기' })).toHaveCount(0)
  await expect.poll(async () => (await inputs()).length, { timeout: 30_000 }).toBe(2)
  expect((await inputs())[1]).toMatch(
    /^relay feedback 1 for head [0-9a-f]{7} is in .*feedback\/1\.md: 1 review finding that the human passed to you\./,
  )
  await shot('feedback-sent')

  // [변경]: 모두 몇 줄, 파일별 diff. 5파일·400줄 이하라 펼친 채로 열린다(M2.1 13절). 누르면 접힌다
  await page.getByRole('tab', { name: '변경' }).click()
  const diff = page.getByTestId('diff-panel')
  await expect(diff.locator('.diff-summary')).toContainText('파일 3개')
  const calcFile = diff.locator('details', { has: page.getByText('src/calc.js', { exact: true }) })
  await expect(calcFile.locator('.patch')).toBeVisible()
  await expect(calcFile.locator('.patch')).toContainText('n > hi ? hi')
  await shot('diff')
  await calcFile.locator('summary').click()
  await expect(calcFile.locator('.patch')).toBeHidden()

  // [머지] → 끝남
  await page.getByRole('tab', { name: '증거' }).click()
  await merge.click()
  await expect(page.locator('.work-head')).toContainText('끝남', { timeout: 30_000 })
  // 끝난 Work는 결과를 먼저, 관문 결론은 그때의 것으로
  await expect(evidence.getByTestId('outcome')).toHaveText(/^머지됨 · PR #1 · [0-9a-f]{7}$/)
  await expect(evidence.getByTestId('verdict')).toContainText('그때의 관문 결론')
  await expect(page.getByTestId('terminal')).toContainText('[세션을 닫음]')
  await shot('merged')
  // 품질 기준이 있는 레포에는 알림이 없다
  await expect(page.getByTestId('quality-notice')).toHaveCount(0)

  // 품질 기준이 없는 레포(V20): 사이드바의 프로젝트 줄에 알림, [초안 만들기]는 작업 트리에 쓰고 커밋은 사람이 한다
  await pickFolder(bare.dir)
  await page.getByRole('button', { name: '+ 프로젝트 추가' }).click()
  const second = page.getByTestId('project').nth(1)
  await expect(second).toContainText(bare.dir.split('/').at(-1) ?? '')
  const notice = second.getByTestId('quality-notice')
  await expect(notice).toContainText('이 레포에는 품질 기준(.relay/quality.json)이 없습니다')
  await notice.getByRole('button', { name: '초안 만들기' }).click()
  await expect(notice.getByTestId('quality-drafted')).toHaveText(
    /^초안을 썼습니다\. 검토하고 기본 브랜치에 커밋하면 다음 Work부터 쓰입니다/,
  )
  expect(JSON.parse(await readFile(bare.path('.relay/quality.json'), 'utf8'))).toMatchObject({
    version: 1,
    auto: [{ id: 'small', max_changed_lines: 100 }],
  })
  // 커밋하지 않았으니 기준은 아직 없다(V9: base에서 읽음)
  await expect(notice).toBeVisible()
  await shot('quality-notice')

  // 그 레포의 새 Work: 계약 → [승인] → 커밋·Stop → 증거(명령 없음). [증거] 탭 위에도 알림
  await second.getByRole('button', { name: '+ 새 Work' }).click()
  const newWork = page.getByRole('dialog', { name: '새 Work' })
  await newWork.getByLabel('요청', { exact: true }).fill(REQUEST)
  await newWork.getByRole('button', { name: '만들기' }).click()
  await expect(newWork).toBeHidden()
  await expect(page.getByTestId('approve-box')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('approve-box').getByRole('button', { name: '승인', exact: true }).click()
  await expect(evidence.getByTestId('conclusion')).toHaveText('사람 머지', { timeout: 60_000 })
  // 작업 트리에 초안이 있으니 [초안 만들기] 대신 커밋하라고 쓴다
  const tabNotice = evidence.getByTestId('quality-notice')
  await expect(tabNotice).toContainText('이 레포에는 품질 기준')
  await expect(tabNotice.getByTestId('quality-drafted')).toHaveText(/^작업 트리에 초안/)
  await expect(tabNotice.getByRole('button', { name: '초안 만들기' })).toHaveCount(0)
  await expect(evidence.getByTestId('next-step')).not.toContainText('relay init')

  // 이 Work의 리뷰는 계약 밖 변경 하나를 low로 올린다(V26: 계약 밖 변경은 low도 올림). 세션 몫의 구조/중간도 하나 올린다.
  // 요청과 어긋남(V30)도 low로 하나 낸다: 메모다(M2.1 0단계 O2가 기준을 넘지 못함). 상자의 열린 것이 아니다.
  // 가짜 리뷰어는 부를 때마다 읽는다
  const outside = {
    severity: 'low',
    raise: 'out_of_contract',
    text: '계약 밖에서 .gitignore를 바꿈',
  }
  const structure = { severity: 'medium', raise: 'structure', text: '경계값 시험이 없음' }
  const gap = { severity: 'low', raise: 'request_gap', text: '요청의 빈 입력 경로를 다루지 않음' }
  await writeFile(
    join(tmp, 'review.json'),
    JSON.stringify({ findings: [outside, structure, gap, ...NOTES] }),
  )

  // [끝내기](V25): 내보내기 증거(리뷰 포함)를 재는 동안은 걸린 끝. Work는 구현 중 그대로
  const head = page.locator('.work-head')
  await head.getByRole('button', { name: '끝내기' }).click()
  const armed = evidence.getByTestId('end-armed')
  await expect(armed).toBeVisible({ timeout: 60_000 })
  await expect(armed).toContainText('끝내기가 걸려 있습니다: 내보내기 증거와 리뷰가 끝나고')
  await expect(head.getByRole('button', { name: '리뷰 끝나면 끝냄' })).toBeDisabled()
  await shot('end-armed')
  // 열린 것(품질 기준 없음 등)이 있으니 상자. 리뷰 메모(올림 없는 지적, 구조/low)는 열린 것이 아니다
  const endBox = evidence.getByTestId('end-box')
  await expect(endBox).toBeVisible({ timeout: 60_000 })
  await expect(armed).toBeHidden()
  await expect(endBox).toContainText('열린 것이 있습니다. 보고 끝낼지 정하세요.')
  await expect(endBox.getByTestId('end-open')).toContainText('품질 기준 없음')
  await expect(endBox.getByTestId('end-open')).toContainText(
    '리뷰 올림(계약 밖 변경): 계약 밖에서 .gitignore를 바꿈',
  )
  await expect(endBox.getByTestId('end-open')).toContainText('리뷰 올림(구조): 경계값 시험이 없음')
  await expect(endBox.getByTestId('end-open')).not.toContainText(
    '요청의 빈 입력 경로를 다루지 않음',
  )
  await expect(endBox.getByText('변수 이름이 짧음')).toHaveCount(0)
  await expect(endBox.getByText('빈 입력 시험이 없음')).toHaveCount(0)
  // 계약 밖 변경은 사람 몫이라 저절로 가지 않았다. 상자가 떠 있는 동안은 세션 몫도 가지 않는다. 상자에서 올림 둘을
  // 세션에 넘길 수 있다(V24). 상태 줄은 상자에 맡긴다
  await expect(endBox.getByRole('button', { name: '세션에 넘기기' })).toBeVisible()
  await expect(evidence.getByTestId('feedback-status')).toHaveCount(0)
  await expect(head).toContainText('구현 중')
  await shot('end-box')
  // [리뷰 지적]은 올림 둘과 메모 셋(요청과 어긋남 포함)으로 나뉜다(V26, V30 메모)
  const fold = evidence.locator('details.fold', {
    has: page.locator('summary', { hasText: '리뷰 지적' }),
  })
  if ((await fold.getAttribute('open')) === null) await fold.locator('summary').click()
  const raisedGroup = evidence.getByTestId('review-raised')
  await expect(raisedGroup).toContainText('올림 2 · 관문이 사람에게 보냅니다')
  // 세션 몫도 상자가 떠 있는 동안은 저절로 가지 않으니 사람이 넘길 수 있다
  await expect(raisedGroup.locator('li')).toHaveText([
    /낮음\s*계약 밖 변경\s*계약 밖에서.*세션에 넘기기$/,
    /중간\s*구조\s*경계값 시험이 없음\s*세션 몫\s*세션에 넘기기$/,
  ])
  await expect(evidence.getByTestId('review-notes')).toContainText('메모 3')
  await expect(evidence.getByTestId('review-notes')).toContainText(
    '요청의 빈 입력 경로를 다루지 않음',
  )
  await fold.scrollIntoViewIfNeeded()
  await shot('review-groups')
  // 다른 Work로 갔다 와도 상자가 남는다(메인이 Work에 둔다)
  await page.getByTestId('project').first().locator('.work-item').first().click()
  await expect(evidence.getByTestId('outcome')).toHaveText(/^머지됨/)
  await expect(endBox).toBeHidden()
  await second.locator('.work-item').first().click()
  await expect(endBox).toBeVisible()
  // [더 고치기]: 상자를 닫고 Work는 그대로. 사람 몫의 올림을 아직 넘기지 않았으니 세션 몫도 보내지 않는다(V24)
  await endBox.getByRole('button', { name: '더 고치기' }).click()
  await expect(endBox).toBeHidden()
  await expect(head).toContainText('구현 중')
  await expect(evidence.getByTestId('feedback-status')).toHaveText(
    /^사람 몫의 리뷰 올림이 있어 세션 몫 사실 1개를 보내지 않았습니다: /,
  )
  if ((await fold.getAttribute('open')) === null) await fold.locator('summary').click()
  await expect(raisedGroup.getByRole('button', { name: '세션에 넘기기' })).toHaveCount(2)
  await evidence.getByTestId('feedback-status').scrollIntoViewIfNeeded()
  await shot('feedback-human-findings')
  // 다시 [끝내기] → 이미 잰 head라 곧바로 상자 → [세션에 넘기기](V35): 올림 둘을 보내고 끝을 '고친 뒤 끝냄'으로 다시 건다
  await head.getByRole('button', { name: '끝내기' }).click()
  await expect(endBox).toBeVisible({ timeout: 30_000 })
  await endBox.getByRole('button', { name: '세션에 넘기기' }).click()
  const handed = evidence.getByTestId('end-handed')
  await expect(handed).toContainText('세션에 넘겼습니다: 세션이 고치고 쉬면')
  await expect(head.getByRole('button', { name: '고치면 끝냄' })).toBeDisabled()
  await shot('end-handed')
  // 세션이 받아 쉬면 그 head를 다시 본다: 품질 기준 없음이 남아 상자가 다시 뜬다 → [그래도 끝내기]
  await expect(endBox.getByTestId('end-open')).toContainText('품질 기준 없음', { timeout: 30_000 })
  await endBox.getByRole('button', { name: '그래도 끝내기' }).click()
  await expect(head).toContainText('끝남', { timeout: 30_000 })
  await expect(evidence.getByTestId('outcome')).toHaveText('머지 없이 끝남')
  await expect(endBox).toBeHidden()
  await shot('ended')

  // 프로젝트 설정
  await page.getByRole('button', { name: /설정$/ }).first().click()
  const settings = page.getByRole('dialog')
  await expect(settings.getByRole('switch')).not.toBeChecked()
  await expect(settings.getByRole('radio', { name: '결정마다 확인' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await shot('settings')
  await settings.getByRole('button', { name: '취소' }).click()
  await expect(settings).toBeHidden()

  // 어두운 테마(시스템을 따른다)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('tab', { name: '계약' }).click()
  await expect(page.getByTestId('contract-panel')).toContainText('승인된 계약')
  await shot('dark')

  // 가장 좁은 창(minWidth 1180): 가운데 터미널이 70열쯤 남는다
  await page.emulateMedia({ colorScheme: 'light' })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 700)
  })
  await expect.poll(() => page.evaluate('innerWidth')).toBe(1180)
  const width = await page.locator('.terminal-pane').evaluate((el) => el.clientWidth)
  expect(width).toBeGreaterThanOrEqual(560)
  await shot('narrow')
})

test('단위 브랜치(V22): 통합 증거 칸과 내보내기마다 칸, 없는 단위 브랜치는 [끝내기] 상자의 열린 것', async () => {
  // 가짜 claude는 뜰 때 시나리오를 읽는다
  await writeFile(join(tmp, 'scenario.json'), JSON.stringify(UNITS))
  await writeFile(join(tmp, 'review.json'), JSON.stringify({ findings: NOTES }))
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900)
  })
  await page.getByTestId('project').first().getByRole('button', { name: '+ 새 Work' }).click()
  const dialog = page.getByRole('dialog', { name: '새 Work' })
  await dialog
    .getByLabel('요청', { exact: true })
    .fill('clamp를 고치고 sub를 더해 주세요. 모듈마다 브랜치로.')
  await dialog.getByRole('button', { name: '만들기' }).click()
  const approve = page.getByTestId('approve-box')
  await expect(approve).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('delivery')).toContainText('단위마다 브랜치: relay/')
  await approve.getByRole('button', { name: '승인', exact: true }).click()
  const evidence = page.getByTestId('evidence-panel')
  await expect(evidence.getByTestId('integration-status')).toHaveText('통합 증거: 열린 것 없음', {
    timeout: 60_000,
  })
  const units = evidence.getByTestId('export')
  await expect(units).toHaveCount(2)
  await expect(units.first().getByTestId('review-meta')).toHaveText(/^리뷰 끝\(이 head\)/, {
    timeout: 60_000,
  })
  await expect(units.first()).toContainText('단위 clamp')
  await expect(units.nth(1).getByTestId('export-missing')).toBeVisible()
  await shot('units')
  await page.locator('.work-head').getByRole('button', { name: '끝내기' }).click()
  await expect(evidence.getByTestId('end-open')).toContainText(/단위 브랜치 없음: relay\/.*--sub/, {
    timeout: 30_000,
  })
  await shot('units-end-box')
})
