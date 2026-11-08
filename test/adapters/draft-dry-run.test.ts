// [어댑터] 초안의 드라이런(V61, src/engine/dry-run.ts)을 실제 도구로: 작은 Go·Python·Rust 레포에서 레시피의 setup과 명령을
// 확인 실행기의 head check worktree에서 한 번씩 돌리고, 안 된 명령은 까닭과 함께 고칠 것으로 빼고, 래칫의 지금 값을 낸다.
// 사람의 작업 트리는 건드리지 않는다. 도구가 없으면(go, python3, cargo) 그 시험은 까닭을 적고 건너뛴다. Python은 pytest와
// pytest-cov를 venv에 받아야 해서 PyPI에 닿지 못하면 건너뛴다.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { repoKey } from '../../src/adapters/store.ts'
import { tryDraft } from '../../src/engine/init.ts'
import { cleanupAll, makeRepo, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const has = (bin: string, ...args: string[]) =>
  spawnSync(bin, args, { stdio: 'ignore', timeout: 30_000 }).status === 0

const GO = has('go', 'version')
const CARGO = has('cargo', '--version')
const PYTHON = has('python3', '-m', 'venv', '--help')
/** pytest를 받을 수 있나(pip download 한 번). 없으면 Python 시험은 건너뛴다 */
const PYPI =
  PYTHON &&
  (() => {
    const dir = join(tmpdir(), `relay-pypi-probe-${process.pid}`)
    const r = spawnSync(
      'python3',
      ['-m', 'pip', 'download', '-q', '--no-deps', '-d', dir, 'iniconfig'],
      {
        stdio: 'ignore',
        timeout: 60_000,
      },
    )
    rmSync(dir, { recursive: true, force: true })
    return r.status === 0
  })()

const why = (ok: boolean, text: string) => (ok ? '' : ` (건너뜀: ${text})`)

describe('드라이런', () => {
  test.skipIf(!GO)(
    `Go: go mod download·go test -json(앱이 시험 수를 읽음)은 되고 go vet은 까닭과 함께 빠진다${why(GO, 'go가 없음')}`,
    async () => {
      const repo = await makeRepo({
        files: {
          'go.mod': 'module example.com/calc\n\ngo 1.22\n',
          'calc/calc.go':
            'package calc\n\n// Add adds.\nfunc Add(a, b int) int { return a + b } //nolint:revive\n\n// One is one.\nfunc One() int {\n\treturn 1\n\tpanic("x")\n}\n',
          'calc/calc_test.go':
            'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal("bad")\n\t}\n}\n\nfunc TestSub(t *testing.T) {\n\tt.Run("zero", func(t *testing.T) {})\n}\n',
        },
      })
      const home = await makeTempDir('relay-home-')
      const r = await tryDraft(repo.dir, home)
      const dry = r.dry
      if (dry === null) throw new Error('돌려 보지 않음')
      expect(dry.commands.map((c) => [c.id, c.kind, c.ok])).toEqual([
        ['setup', 'setup', true],
        ['vet', 'fast', false],
        ['test', 'acceptance', true],
      ])
      // go test가 함께 도는 vet 일부(printf 등)에 없는 검사(unreachable)라 시험은 된다
      expect(dry.commands[1]?.reason).toMatch(/^종료 코드 1: .*unreachable code/)
      expect(dry.fixes.map((f) => f.id)).toEqual(['vet'])
      expect(r.config.commands.fast).toEqual([])
      expect(r.config.commands.acceptance).toEqual({
        id: 'test',
        run: 'go test -json ./... > .relay-out/go-test.json',
        junit: '.relay-out/go-test.json',
        test_format: 'go-test-json',
      })
      // gotestsum 없이 시험 수 래칫: TestAdd, TestSub, TestSub/zero
      expect(dry.values.find((v) => v.id === 'tests')?.text).toBe('시험 3')
      expect(dry.values.find((v) => v.id === 'suppressions')?.text).toBe('억누름 1 (//nolint 1)')
      // 명령은 확인 실행기의 head check worktree에서 돌았다. 사람의 작업 트리는 그대로다
      expect(
        existsSync(join(home, 'worktrees', repoKey(repo.dir), 'head', 'calc', 'calc.go')),
      ).toBe(true)
      expect(await repo.git('status', '--porcelain')).toBe('')
    },
    120_000,
  )

  test.skipIf(!PYPI)(
    `Python(pip): venv에 requirements를 받고, pytest의 JUnit과 pytest-cov의 Cobertura를 앱이 읽는다${why(PYPI, PYTHON ? 'PyPI에 닿지 못함' : 'python3(venv)이 없음')}`,
    async () => {
      const repo = await makeRepo({
        files: {
          'requirements-dev.txt': 'pytest\npytest-cov\n',
          'app/__init__.py': '',
          'app/calc.py':
            'def add(a, b):\n    return a + b  # type: ignore\n\n\ndef unused():\n    return 0\n',
          'tests/__init__.py': '',
          'tests/test_calc.py':
            'from app.calc import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n',
        },
      })
      const home = await makeTempDir('relay-home-')
      const r = await tryDraft(repo.dir, home)
      const dry = r.dry
      if (dry === null) throw new Error('돌려 보지 않음')
      expect(dry.commands.map((c) => [c.id, c.ok, c.reason ?? ''])).toEqual([
        ['setup', true, ''],
        ['test', true, ''],
      ])
      expect(dry.values.map((v) => [v.id, v.text])).toEqual([
        ['tests', '시험 1'],
        [
          'diff-coverage',
          expect.stringMatching(/^바뀐 줄 커버리지: 보고서를 읽음\(파일 \d+개\), 바닥 80\.0%$/),
        ],
        ['file-size', '600줄 넘는 파일 0'],
        ['suppressions', '억누름 1 (# type: ignore 1)'],
        ['duplication', expect.stringMatching(/^중복 0\.0% /)],
      ])
      expect(dry.fixes).toEqual([])
      expect(r.config.ratchets.map((x) => x.id)).toEqual([
        'tests',
        'file-size',
        'suppressions',
        'duplication',
        'diff-coverage',
      ])
      expect(r.plan.suggestions).toContain(
        'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다',
      )
    },
    300_000,
  )

  test.skipIf(!CARGO)(
    `Rust: cargo fetch·cargo check·cargo test${why(CARGO, 'cargo가 없음')}`,
    async () => {
      const repo = await makeRepo({
        files: {
          'Cargo.toml':
            '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
          'Cargo.lock':
            '# This file is automatically @generated by Cargo.\nversion = 4\n\n[[package]]\nname = "calc"\nversion = "0.1.0"\n',
          'src/lib.rs':
            '#[allow(dead_code)]\nfn unused() {}\n\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() {\n        assert_eq!(super::add(1, 2), 3);\n    }\n}\n',
        },
      })
      const home = await makeTempDir('relay-home-')
      const r = await tryDraft(repo.dir, home)
      const dry = r.dry
      if (dry === null) throw new Error('돌려 보지 않음')
      expect(dry.commands.map((c) => [c.id, c.ok, c.reason ?? ''])).toEqual([
        ['setup', true, ''],
        ['check', true, ''],
        ['test', true, ''],
      ])
      expect(dry.values.find((v) => v.id === 'suppressions')?.text).toBe('억누름 1 (#[allow( 1)')
    },
    180_000,
  )

  test('커밋이 없는 레포는 돌려 보지 못하고 명령은 모두 고칠 것이다', async () => {
    const dir = await makeTempDir('relay-empty-')
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }))
    const r = await tryDraft(dir, await makeTempDir('relay-home-'))
    expect(r.dry?.head).toBeNull()
    expect(r.dry?.fixes.map((f) => [f.id, f.reason])).toEqual([
      ['lint', '커밋이 없어 돌려 보지 못함'],
    ])
    expect(r.config.commands.fast).toEqual([])
  })
})
