// [흐름] Python(uv) 레포의 [초안 만들기] → 드라이런 요약 → [초안 쓰기](V60~V62, src/main/works-projects.ts): 앱이 레시피로
// 짠 초안을 지금 커밋에서 한 번 돌려 명령마다 됨·안 됨과 까닭, 래칫의 지금 값, 고칠 것, 묻는 것(셋)을 내고, 답을 넣은 초안을
// 작업 트리에만 쓴다(커밋하지 않는다). 명령은 가짜 uv(test/support/fake-uv)가 받는다. 레시피의 자세한 것은 [단위]
// draft-recipes.test.ts, 드라이런의 실제 도구는 [어댑터] draft-dry-run.test.ts.
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { beforeAll, expect, test, vi } from 'vitest'
import { parseQuality } from '../../src/core/quality.ts'
import { structureRatchet } from '../../src/engine/draft.ts'
import { FAKE_UV_DIR, pathKey } from '../support/fakes.ts'
import { makeRepo, makeTempDir } from '../support/repo.ts'
import { flowKit } from '../support/works-flow.ts'

const kit = flowKit()
const windows = process.platform === 'win32'

const PYPROJECT = `[project]
name = "calc"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = ["pytest>=8", "pytest-cov>=5", "ruff>=0.6", "radon>=6"]
`

beforeAll(() => {
  const key = pathKey()
  vi.stubEnv(key, `${FAKE_UV_DIR}${delimiter}${process.env[key] ?? ''}`)
})

test.skipIf(windows)(
  'Python(uv) 레포: 드라이런 요약(됨·안 됨, 지금 값, 고칠 것, 묻는 것), 답을 넣은 초안을 작업 트리에만 쓴다',
  async () => {
    const repo = await makeRepo({
      files: {
        'pyproject.toml': PYPROJECT,
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
          'on: push\njobs:\n  test:\n    name: Python tests\n    steps: []\n',
      },
    })
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const project = await works.addProject(repo.dir)
    expect(project.quality).toBe('missing')
    const commits = await repo.git('rev-list', '--count', 'HEAD')

    const v = await works.draftQuality(project.id)
    expect(v.units).toEqual([{ label: 'Python (uv)', dir: '.' }])
    expect(v.head).toBe(await repo.git('rev-parse', 'HEAD'))
    expect(v.commands.map((c) => [c.kind, c.id, c.ok])).toEqual([
      ['setup', 'setup', true],
      ['fast', 'lint', false],
      ['acceptance', 'test', true],
      ['ratchet', 'complexity', true],
    ])
    expect(v.commands[1]).toMatchObject({
      run: 'uv run ruff check .',
      reason: '종료 코드 1: Found 1 error.',
    })
    expect(v.values).toEqual([
      { id: 'tests', text: '시험 2' },
      { id: 'diff-coverage', text: '바뀐 줄 커버리지: 보고서를 읽음(파일 1개), 바닥 80.0%' },
      { id: 'complexity', text: 'complexity 1' },
      { id: 'file-size', text: '600줄 넘는 파일 0' },
      { id: 'suppressions', text: '억누름 1 (# noqa 1)' },
      { id: 'duplication', text: '중복 0.0% (코드 줄 4, 쌍 0)' },
    ])
    expect(v.fixes.map((f) => f.id)).toEqual(['lint'])
    expect(v.questions.map((q) => [q.id, q.options.map((o) => o.value)])).toEqual([
      ['human_paths', ['migrations/**']],
      ['boundaries', ['app/db:app/ui']],
      ['ci_checks', ['Python tests']],
    ])
    expect(v.suggestions).toEqual([])
    expect(v.exists).toBe(false)
    // 드라이런은 작업 트리에 쓰지 않는다
    expect(await repo.git('status', '--porcelain')).toBe('')

    const target = join(repo.dir, '.relay', 'quality.json')
    expect(
      await works.writeQualityDraft(project.id, {
        human_paths: ['migrations/**'],
        boundaries: ['app/db:app/ui'],
        ci_checks: ['Python tests'],
      }),
    ).toEqual({ written: true, path: target })
    const q = parseQuality(await readFile(target, 'utf8'))
    if (!q.ok) throw new Error(q.errors.join('; '))
    expect(q.value.setup).toEqual({
      run: 'uv sync',
      inputs: ['pyproject.toml', 'uv.lock'],
      keep: ['.venv'],
    })
    // 안 된 린트는 빠졌다
    expect(q.value.commands.fast).toEqual([])
    expect(q.value.commands.acceptance?.run).toMatch(/^uv run pytest --junitxml=/)
    expect(q.value.commands.full).toEqual({ ci_checks: ['Python tests'] })
    expect(q.value.human_paths).toEqual(['migrations/**'])
    expect(q.value.ratchets.map((r) => r.id)).toEqual([
      'tests',
      'file-size',
      'suppressions',
      'duplication',
      'diff-coverage',
      'complexity',
      'boundary-db-ui',
    ])
    expect(q.value.ratchets.at(-1)).toEqual(structureRatchet('app/db:app/ui'))
    // 앱은 커밋하지 않는다(V20): 초안은 작업 트리의 새 파일이고, 화면은 초안이 있다고 알린다
    expect(await repo.git('rev-list', '--count', 'HEAD')).toBe(commits)
    expect(await repo.git('status', '--porcelain')).toBe('?? .relay/')
    await works.refreshProjects()
    expect(works.list().projects.find((p) => p.id === project.id)).toMatchObject({
      quality: 'missing',
      qualityDraft: true,
    })
  },
)
