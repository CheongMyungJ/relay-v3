// [스모크] 품질 기준 초안 화면 (V60~V62, docs/quality-floor.md 5.1·7절). 품질 기준이 없는 Python(uv) 레포를 더하고 사이드바의
// [초안 만들기]를 누르면 앱이 지금 커밋에서 한 번 돌려 본 결과가 대화상자로 뜬다: 언어, 돌려 본 명령(됨·안 됨과 까닭), 래칫의
// 지금 값, 고칠 것(빠진 린트), 묻는 것 셋(늘 볼 경로, 경계, CI 검사). 답을 고르고 [초안 쓰기]를 누르면 작업 트리에 쓰고 알림이
// 커밋하라고 바뀐다. 앱은 커밋하지 않는다. 명령은 가짜 uv(test/support/fake-uv)가 받는다. test-results/smoke-draft-*.png를 남긴다.
//   xvfb-run -a npm run test:smoke
import { readFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { FAKE_UV_DIR, pathKey } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'test-results')

let tmp: string
let repo: TestRepo
let app: ElectronApplication
let page: Page

test.skip(process.platform === 'win32', '가짜 uv는 sh 스크립트')

test.beforeAll(async () => {
  tmp = await makeTempDir('relay-smoke-draft-')
  repo = await makeRepo({
    files: {
      'pyproject.toml':
        '[project]\nname = "calc"\nversion = "0.1.0"\n\n[dependency-groups]\ndev = ["pytest>=8", "pytest-cov>=5", "ruff>=0.6"]\n',
      'uv.lock': 'version = 1\n',
      '.gitignore': '.venv/\n.relay-out/\n',
      'app/__init__.py': '',
      'app/calc.py': 'import os  # noqa: F401\n\ndef clamp(n, lo, hi):\n    return lo\n',
      'app/ui/view.py': 'from app.db import rows\n',
      'app/ui/form.py': 'from app.db import rows\n',
      'app/ui/list.py': 'from app.db import rows\n',
      'app/ui/menu.py': 'from app.db import rows\n',
      'app/ui/page.py': 'from app.db import rows\n',
      'app/db/rows.py': 'rows = []\n',
      'migrations/001_init.py': 'up = 1\n',
      'tests/test_calc.py': 'from app.calc import clamp\n',
      '.github/workflows/ci.yml':
        'on: push\njobs:\n  test:\n    name: Python tests\n    steps: []\n  lint:\n    steps: []\n',
    },
  })
  const key = pathKey()
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: {
      ...(process.env as Record<string, string>),
      [key]: `${FAKE_UV_DIR}${delimiter}${process.env[key] ?? ''}`,
      RELAY_HOME: join(tmp, 'home'),
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
  await page.screenshot({ path: join(SHOTS, `smoke-draft-${n}-${name}.png`) })
}

test('[초안 만들기] → 지금 값, 고칠 것, 묻는 것 → 답을 골라 [초안 쓰기]', async () => {
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  const notice = page.getByTestId('project').getByTestId('quality-notice')
  await expect(notice).toContainText('이 레포에는 품질 기준(.relay/quality.json)이 없습니다')
  await notice.getByRole('button', { name: '초안 만들기' }).click()

  const dialog = page.getByRole('dialog', { name: /^품질 기준 초안/ })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toContainText('언어: Python (uv).')
  await expect(dialog).toContainText(/지금 커밋 [0-9a-f]{7}에서 한 번씩 돌려 봤습니다/)
  const commands = dialog.getByTestId('draft-commands')
  await expect(commands.locator('li')).toHaveCount(3)
  await expect(commands).toContainText('uv run ruff check .')
  await expect(commands).toContainText('종료 코드 1: Found 1 error.')
  const values = dialog.getByTestId('draft-values')
  await expect(values).toContainText('시험 2')
  await expect(values).toContainText('억누름 1 (# noqa 1)')
  await expect(values).toContainText('바뀐 줄 커버리지: 보고서를 읽음(파일 1개), 바닥 80.0%')
  await expect(dialog.getByTestId('draft-fixes')).toContainText('lint')
  await expect(dialog.getByTestId('draft-questions').locator('fieldset')).toHaveCount(3)
  await expect(dialog.getByTestId('draft-suggestions')).toContainText('radon을 dev 의존성에')
  await shot('dialog')

  await dialog.getByLabel('migrations/**').check()
  await dialog.getByLabel('app/db는 app/ui를 가져오지 않음', { exact: false }).check()
  await dialog.getByLabel('Python tests').check()
  await dialog.getByRole('textbox', { name: /^늘 사람이 볼 경로.*더 적기$/ }).fill('app/db/**')
  await dialog.getByTestId('draft-questions').scrollIntoViewIfNeeded()
  await shot('answers')
  await dialog.getByRole('button', { name: '초안 쓰기' }).click()
  await expect(dialog).toBeHidden()
  await expect(notice.getByTestId('quality-drafted')).toHaveText(
    /^초안을 썼습니다\. 검토하고 기본 브랜치에 커밋하면 다음 Work부터 쓰입니다/,
  )
  const q = JSON.parse(await readFile(repo.path('.relay/quality.json'), 'utf8')) as {
    human_paths: string[]
    commands: { fast: unknown[]; full?: { ci_checks: string[] } }
    ratchets: { id: string }[]
  }
  expect(q.human_paths).toEqual(['migrations/**', 'app/db/**'])
  expect(q.commands.fast).toEqual([])
  expect(q.commands.full?.ci_checks).toEqual(['Python tests'])
  expect(q.ratchets.map((r) => r.id)).toContain('boundary-db-ui')
  // 앱은 커밋하지 않는다
  expect(await repo.git('status', '--porcelain')).toBe('?? .relay/')
  await shot('written')
})
