// [단위] 여러 언어 초안(docs/quality-floor.md 5.2, V60~V62): 매니페스트 묶음(파일 목록과 글)마다 기대한 quality.json, 묻는 것의
// 후보, 답 넣기. JS 하나뿐인 레포는 core draftQuality(V19) 그대로이고 줄 수 래칫의 범위(소스 파일, V66)와 래칫 둘(억누름, 중복)만
// 다르다. Go의 go test -json(V65)은 시범(docs/experiments/quality-floor-pilot)의 레포 모양 그대로. 이어 붙인 test 스크립트(V64)는
// draft-js-split.test.ts.
import { describe, expect, test } from 'vitest'
import { draftQuality, parseQuality } from '../../src/core/quality.ts'
import type { QualityConfig, RatchetSpec } from '../../src/core/types.ts'
import {
  applyAnswers,
  boundaryRatchet,
  planDraft,
  SOURCE_GLOB,
  workflowJobs,
  type DraftPlan,
} from '../../src/engine/draft.ts'
import { goTools, hasDep, mergeJUnit, nextestJUnit, unitDirs } from '../../src/engine/recipes.ts'

/** 파일 목록과 글. 글이 null이면 목록에만 있다 */
function plan(files: Record<string, string | null>): DraftPlan {
  const texts = new Map<string, string>()
  for (const [p, t] of Object.entries(files)) if (t !== null) texts.set(p, t)
  const out = planDraft({ files: Object.keys(files), texts })
  // 초안은 늘 품질 기준으로 읽힌다
  const parsed = parseQuality(JSON.stringify(out.config))
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return out
}

const APP_RATCHETS: RatchetSpec[] = [
  { id: 'suppressions', kind: 'suppressions' },
  { id: 'duplication', kind: 'duplication' },
]
const ids = (q: QualityConfig) => q.ratchets.map((r) => r.id)
/** 초안의 줄 수 래칫: 소스 파일만(V66) */
const FILE_SIZE: RatchetSpec = {
  id: 'file-size',
  kind: 'file_lines',
  max: 600,
  include: [SOURCE_GLOB],
}

describe('JS: core 초안 그대로, 줄 수 래칫의 범위와 래칫 둘만 다름', () => {
  const cases: [string, Record<string, string | null>][] = [
    [
      'npm, vitest, CI',
      {
        'package.json': JSON.stringify({
          scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' },
        }),
        'package-lock.json': null,
        'src/a.ts': null,
        '.github/workflows/ci.yml': 'jobs:\n  test:\n    runs-on: x\n',
      },
    ],
    [
      'node:test, pnpm',
      {
        'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
        'pnpm-lock.yaml': null,
      },
    ],
    [
      '모르는 러너는 빠른 검사',
      { 'package.json': JSON.stringify({ scripts: { lint: 'x', test: 'jest' } }) },
    ],
    ['스크립트 없음', { 'package.json': '{ "name": "calc2" }' }],
    ['아무것도 없음', {}],
    ['package.json 없이 잠금 파일만', { 'yarn.lock': null, 'README.md': null }],
  ]
  test.each(cases)('%s', (_name, files) => {
    const pkg = files['package.json'] ?? undefined
    const legacy = draftQuality(
      pkg === undefined
        ? { files: Object.keys(files) }
        : { packageJson: pkg, files: Object.keys(files) },
    )
    const q = plan(files).config
    const ratchets = legacy.ratchets.map((r) => (r.kind === 'file_lines' ? FILE_SIZE : r))
    expect(q).toEqual({ ...legacy, ratchets: [...ratchets, ...APP_RATCHETS] })
    // JSON의 칸 차례도 같다(래칫 끝만 다르다)
    expect(JSON.stringify({ ...q, ratchets: [] })).toBe(JSON.stringify({ ...legacy, ratchets: [] }))
  })

  test('vitest에 커버리지 제공자가 있으면 수용 시험이 lcov를 쓰고 바뀐 줄 커버리지를 넣는다', () => {
    const pkg = {
      scripts: { test: 'vitest run' },
      devDependencies: { '@vitest/coverage-v8': '3.0.0' },
    }
    const p = plan({ 'package.json': JSON.stringify(pkg), 'package-lock.json': null })
    expect(p.config.commands.acceptance?.run).toBe(
      'npx vitest run --reporter=junit --outputFile=.relay-out/junit.xml --coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=.relay-out/coverage',
    )
    expect(p.config.ratchets.at(-1)).toEqual({
      id: 'diff-coverage',
      kind: 'diff_coverage',
      report: '.relay-out/coverage/lcov.info',
      format: 'lcov',
      min: 0.8,
    })
    // 없으면 넣지 않고 제안만
    const bare = plan({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) })
    expect(ids(bare.config)).toEqual(['tests', 'file-size', 'suppressions', 'duplication'])
    expect(bare.suggestions).toEqual([
      '@vitest/coverage-v8을 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    ])
  })

  test('bun 잠금 파일: bun install과 bun run', () => {
    const q = plan({
      'package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'jest' } }),
      'bun.lock': null,
    }).config
    expect(q.setup).toEqual({
      run: 'bun install --frozen-lockfile',
      inputs: ['bun.lock'],
      keep: ['node_modules'],
    })
    expect(q.commands.fast).toEqual([
      { id: 'lint', run: 'bun run lint' },
      { id: 'test', run: 'bun run test' },
    ])
    expect(q.ratchets[0]).toEqual(FILE_SIZE)
  })
})

describe('Python', () => {
  const pyproject = (deps: string[], extra = '') =>
    `[project]\nname = "app"\ndependencies = ["requests>=2"]\n\n[dependency-groups]\ndev = [${deps.map((d) => `"${d}"`).join(', ')}]\n${extra}`

  test('uv: uv sync, ruff·mypy, pytest(JUnit)와 pytest-cov(Cobertura), radon 복잡도 래칫', () => {
    const p = plan({
      'pyproject.toml': pyproject(['pytest>=8', 'pytest-cov', 'ruff', 'mypy', 'radon']),
      'uv.lock': null,
      'src/app/__init__.py': null,
      'tests/test_app.py': null,
    })
    expect(p.units).toEqual([{ label: 'Python (uv)', dir: '.' }])
    expect(p.config.setup).toEqual({
      run: 'uv sync',
      inputs: ['pyproject.toml', 'uv.lock'],
      keep: ['.venv'],
    })
    expect(p.config.commands).toEqual({
      fast: [
        { id: 'lint', run: 'uv run ruff check .' },
        { id: 'types', run: 'uv run mypy src' },
      ],
      acceptance: {
        id: 'test',
        run: 'uv run pytest --junitxml=.relay-out/junit.xml --cov=. --cov-report=xml:.relay-out/coverage.xml',
        junit: '.relay-out/junit.xml',
      },
    })
    expect(p.config.ratchets).toEqual([
      { id: 'tests', kind: 'test_count' },
      FILE_SIZE,
      ...APP_RATCHETS,
      {
        id: 'diff-coverage',
        kind: 'diff_coverage',
        report: '.relay-out/coverage.xml',
        format: 'cobertura',
        min: 0.8,
      },
      {
        id: 'complexity',
        kind: 'command',
        run: "uv run radon cc -n C -i .venv . | awk '/ - [C-F] /{n++} END{print n+0}'",
        better: 'lower',
      },
    ])
    expect(p.suggestions).toEqual([])
  })

  test('poetry: poetry install과 poetry run, 빠진 도구는 제안만', () => {
    const p = plan({
      'pyproject.toml':
        '[tool.poetry]\nname = "x"\n\n[tool.poetry.group.dev.dependencies]\npytest = "^8.0"\n# ruff = "^0.5"\n',
      'poetry.lock': null,
      'x/__init__.py': null,
    })
    expect(p.config.setup).toEqual({
      run: 'poetry install',
      inputs: ['pyproject.toml', 'poetry.lock'],
      keep: ['.venv'],
    })
    expect(p.config.commands).toEqual({
      fast: [],
      acceptance: {
        id: 'test',
        run: 'poetry run pytest --junitxml=.relay-out/junit.xml',
        junit: '.relay-out/junit.xml',
      },
    })
    expect(ids(p.config)).toEqual(['tests', 'file-size', 'suppressions', 'duplication'])
    expect(p.suggestions).toEqual([
      'ruff를 dev 의존성에 더하면 빠른 검사(lint)를 쓸 수 있습니다',
      'pytest-cov를 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
      'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다',
    ])
  })

  test('pip: venv에 requirements를 깔고 .venv/bin의 도구로 돈다', () => {
    const q = plan({
      'requirements.txt': 'flask==3.0\n',
      'requirements-dev.txt': '-r requirements.txt\npytest==8.2\nflake8\n',
      'app.py': null,
    }).config
    expect(q.setup).toEqual({
      run: 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt',
      inputs: ['requirements.txt', 'requirements-dev.txt'],
      keep: ['.venv'],
    })
    expect(q.commands.fast).toEqual([{ id: 'lint', run: '.venv/bin/flake8' }])
    expect(q.commands.acceptance?.run).toBe('.venv/bin/pytest --junitxml=.relay-out/junit.xml')
  })

  test('pyproject만(PEP 621): dev 묶음을 -e로 깔고, 도구 설정만 있는 pyproject는 단위가 아니다', () => {
    const q = plan({
      'pyproject.toml':
        '[project]\nname = "x"\n\n[project.optional-dependencies]\ndev = ["pytest"]\n',
      'x.py': null,
    }).config
    expect(q.setup?.run).toBe("python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'")
    expect(plan({ 'pyproject.toml': '[tool.ruff]\nline-length = 100\n' }).units).toEqual([])
  })

  test('의존성 이름 찾기: 버전 꼴, 이름이 앞에 든 다른 꾸러미, 주석', () => {
    expect(hasDep('dev = ["pytest>=8"]', 'pytest')).toBe(true)
    expect(hasDep('pytest = "^8"', 'pytest')).toBe(true)
    expect(hasDep('pytest_cov==5', 'pytest-cov')).toBe(true)
    expect(hasDep('dev = ["pytest-cov"]', 'pytest')).toBe(false)
    expect(hasDep('[tool.ruff]', 'ruff')).toBe(false)
    expect(hasDep('# uses ruff', 'ruff')).toBe(false)
  })
})

describe('Go', () => {
  test('go mod download, go vet, gotestsum이 tool이면 JUnit, 없으면 앱이 go test -json을 읽는다(V65)', () => {
    // 시범의 pflag 모양: tool 지시문 없음, .golangci 설정
    const files = {
      'go.mod': 'module github.com/spf13/pflag\n\ngo 1.12\n',
      'go.sum': null,
      'flag.go': null,
      'flag_test.go': null,
      '.golangci.yaml': null,
    }
    const q = plan(files).config
    expect(q.setup).toEqual({ run: 'go mod download', inputs: ['go.mod', 'go.sum'], keep: [] })
    expect(q.commands).toEqual({
      fast: [
        { id: 'vet', run: 'go vet ./...' },
        { id: 'lint', run: 'golangci-lint run' },
      ],
      acceptance: {
        id: 'test',
        run: 'go test -json ./... > .relay-out/go-test.json',
        junit: '.relay-out/go-test.json',
        test_format: 'go-test-json',
      },
    })
    expect(ids(q)).toEqual(['tests', 'file-size', 'suppressions', 'duplication'])
    // uuid 모양(설정 파일도 없음)도 같은 수용 시험이고 gotestsum 제안은 없다
    const uuid = plan({ 'go.mod': 'module github.com/google/uuid\n', 'uuid.go': null })
    expect(uuid.config.commands.fast).toEqual([{ id: 'vet', run: 'go vet ./...' }])
    expect(uuid.config.commands.acceptance?.test_format).toBe('go-test-json')
    expect(uuid.suggestions).toEqual([
      'govulncheck를 go.mod의 tool로 더하면 취약점 수 래칫을 쓸 수 있습니다',
    ])
    const withTool = plan({
      ...files,
      'go.mod':
        'module x\n\ngo 1.24\n\ntool (\n\tgotest.tools/gotestsum\n\tgolang.org/x/vuln/cmd/govulncheck\n)\n',
    })
    expect(withTool.config.commands.acceptance).toEqual({
      id: 'test',
      run: 'go tool gotestsum --junitfile .relay-out/junit.xml -- ./...',
      junit: '.relay-out/junit.xml',
    })
    expect(withTool.suggestions).toEqual([])
  })

  test('go.mod의 tool 지시문', () => {
    expect(
      goTools('tool golang.org/x/tools/cmd/stringer // 주석\ntool (\n  a/b\n  c\n)\n'),
    ).toEqual(['a/b', 'c', 'golang.org/x/tools/cmd/stringer'])
  })
})

describe('Java·Kotlin', () => {
  test('Maven(mvnw): 컴파일, checkstyle, 시험 보고서를 하나의 JUnit으로, jacoco면 JaCoCo 보고서', () => {
    const pom =
      '<project><build><plugins><plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin><plugin><artifactId>jacoco-maven-plugin</artifactId></plugin></plugins></build></project>'
    const p = plan({ 'pom.xml': pom, mvnw: null, 'src/main/java/A.java': null })
    expect(p.units).toEqual([{ label: 'Java (Maven)', dir: '.' }])
    expect(p.config.setup).toBeUndefined()
    expect(p.config.commands).toEqual({
      fast: [
        { id: 'compile', run: './mvnw -B -q -DskipTests test-compile' },
        { id: 'checkstyle', run: './mvnw -B -q checkstyle:check' },
      ],
      acceptance: {
        id: 'test',
        run: `./mvnw -B test jacoco:report; s=$?; ${mergeJUnit('target/surefire-reports')}; exit $s`,
        junit: '.relay-out/junit.xml',
      },
    })
    expect(p.config.ratchets.find((r) => r.kind === 'diff_coverage')).toMatchObject({
      report: 'target/site/jacoco/jacoco.xml',
      format: 'jacoco',
    })
  })

  test('Gradle(Kotlin): gradlew, ktlint, jacoco XML이 켜졌을 때만 커버리지', () => {
    const build =
      'plugins {\n  kotlin("jvm") version "2.0.0"\n  id("org.jlleitschuh.gradle.ktlint") version "12.1.0"\n  jacoco\n}\n'
    const files = { 'build.gradle.kts': build, gradlew: null, 'src/main/kotlin/A.kt': null }
    const p = plan(files)
    expect(p.units).toEqual([{ label: 'Kotlin (Gradle)', dir: '.' }])
    expect(p.config.commands.fast).toEqual([
      { id: 'compile', run: './gradlew --no-daemon -q testClasses' },
      { id: 'ktlint', run: './gradlew --no-daemon -q ktlintCheck' },
    ])
    expect(p.config.commands.acceptance?.run).toBe(
      `./gradlew --no-daemon test; s=$?; ${mergeJUnit('build/test-results/test')}; exit $s`,
    )
    expect(ids(p.config)).not.toContain('diff-coverage')
    const xml = plan({
      ...files,
      'build.gradle.kts': `${build}tasks.jacocoTestReport { reports { xml.required.set(true) } }\n`,
    })
    expect(xml.config.commands.acceptance?.run).toMatch(
      /^\.\/gradlew --no-daemon test jacocoTestReport;/,
    )
    expect(xml.config.ratchets.find((r) => r.kind === 'diff_coverage')).toMatchObject({
      report: 'build/reports/jacoco/test/jacocoTestReport.xml',
      format: 'jacoco',
    })
  })

  test('Gradle(Java) 래퍼가 없으면 gradle', () => {
    const p = plan({ 'build.gradle': "plugins { id 'java' }\n", 'src/main/java/A.java': null })
    expect(p.units[0]?.label).toBe('Java (Gradle)')
    expect(p.config.commands.fast[0]?.run).toBe('gradle --no-daemon -q testClasses')
  })

  test('JUnit 묶기 조각은 XML 선언 줄만 빼고 testsuites로 감싼다', () => {
    expect(mergeJUnit('target/surefire-reports')).toBe(
      "mkdir -p .relay-out && { echo '<testsuites>'; find . -path '*/target/surefire-reports/TEST-*.xml' -exec sed '/^<?xml/d' {} +; echo '</testsuites>'; } > .relay-out/junit.xml",
    )
  })
})

describe('Rust', () => {
  test('cargo fetch, 엄격한 clippy 표시가 없으면 cargo check, cargo test, rustfmt 설정이면 형식', () => {
    const q = plan({
      'Cargo.toml': '[package]\nname = "x"\n',
      'Cargo.lock': null,
      'rustfmt.toml': null,
      'src/lib.rs': null,
    }).config
    expect(q.setup).toEqual({
      run: 'cargo fetch',
      inputs: ['Cargo.toml', 'Cargo.lock'],
      keep: ['target'],
    })
    expect(q.commands.fast).toEqual([
      { id: 'check', run: 'cargo check --all-targets' },
      { id: 'format', run: 'cargo fmt --check' },
      { id: 'test', run: 'cargo test' },
    ])
    expect(q.ratchets[0]).toEqual(FILE_SIZE)
  })

  test('[lints.clippy]면 clippy -D warnings, nextest의 JUnit profile이면 수용 시험', () => {
    const q = plan({
      'Cargo.toml': '[package]\nname = "x"\n\n[lints.clippy]\nall = "warn"\n',
      '.config/nextest.toml':
        '[profile.ci]\nfail-fast = false\n\n[profile.ci.junit]\npath = "junit.xml"\n',
      'src/lib.rs': null,
    }).config
    expect(q.commands.fast).toEqual([
      { id: 'clippy', run: 'cargo clippy --all-targets -- -D warnings' },
    ])
    expect(q.commands.acceptance).toEqual({
      id: 'test',
      run: 'cargo nextest run --profile ci',
      junit: 'target/nextest/ci/junit.xml',
    })
    expect(nextestJUnit('[profile.default]\nretries = 1\n')).toBeNull()
  })
})

describe('여러 언어가 섞인 레포', () => {
  const files = {
    'web/package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run' } }),
    'web/package-lock.json': null,
    'web/src/a.ts': null,
    'api/pyproject.toml':
      '[project]\nname = "api"\n[dependency-groups]\ndev = ["pytest", "ruff"]\n',
    'api/uv.lock': null,
    'api/app/a.py': null,
    'api/app/b.py': null,
    'tools/go.mod': 'module t\n',
    'tools/main.go': null,
  }

  test('언어마다 그 폴더에서 돌고, 수용 시험은 소스가 가장 많은 단위, 나머지 시험은 빠른 검사', () => {
    const p = plan(files)
    expect(p.units).toEqual([
      { label: 'JS/TS', dir: 'web' },
      { label: 'Python (uv)', dir: 'api' },
      { label: 'Go', dir: 'tools' },
    ])
    expect(p.config.setup).toEqual({
      run: '(cd web && npm ci) && (cd api && uv sync) && (cd tools && go mod download)',
      inputs: ['web/package-lock.json', 'api/pyproject.toml', 'api/uv.lock', 'tools/go.mod'],
      keep: ['web/node_modules', 'api/.venv'],
    })
    expect(p.config.commands).toEqual({
      fast: [
        { id: 'web-lint', run: 'cd web && npm run lint' },
        { id: 'web-test', run: 'cd web && npm run test' },
        { id: 'api-lint', run: 'cd api && uv run ruff check .' },
        { id: 'tools-vet', run: 'cd tools && go vet ./...' },
        { id: 'tools-test', run: 'cd tools && go test ./...' },
      ],
      acceptance: {
        id: 'test',
        run: 'cd api && uv run pytest --junitxml=.relay-out/junit.xml',
        junit: 'api/.relay-out/junit.xml',
      },
    })
    expect(p.config.ratchets[1]).toEqual(FILE_SIZE)
    expect(p.suggestions[0]).toMatch(/^JS\/TS\(web\): /)
  })

  test('루트에 매니페스트가 있으면 루트 하나, 없으면 얕은 폴더 셋까지(넘으면 제안만)', () => {
    expect(unitDirs(['package.json', 'packages/a/package.json']).dirs).toEqual([
      { lang: 'js', dir: '.' },
    ])
    const many = ['a', 'b', 'c', 'd'].map((d) => `svc/${d}/go.mod`)
    expect(unitDirs(many)).toEqual({ dirs: [], skipped: ['Go: svc/a, svc/b, svc/c, svc/d'] })
    expect(unitDirs(['node_modules/x/package.json', 'a/b/c/go.mod']).dirs).toEqual([])
  })

  test('루트 단위와 다른 단위의 setup을 잇는다', () => {
    const q = plan({
      'package.json': '{"scripts":{"lint":"x"}}',
      'package-lock.json': null,
      'svc/go.mod': 'module s\n',
      'svc/a.go': null,
    }).config
    expect(q.setup?.run).toBe('{ npm ci; } && (cd svc && go mod download)')
    expect(q.commands.fast.map((c) => c.id)).toEqual(['js-lint', 'svc-vet'])
    expect(q.commands.acceptance).toMatchObject({
      run: 'cd svc && go test -json ./... > .relay-out/go-test.json',
      junit: 'svc/.relay-out/go-test.json',
      test_format: 'go-test-json',
    })
  })
})

describe('묻는 것과 답', () => {
  const files = {
    'package.json': '{"scripts":{"test":"node --test"}}',
    'src/ui/a.ts': null,
    'src/db/b.ts': null,
    'db/migrations/001.sql': null,
    'src/auth/c.ts': null,
    'node_modules/auth/x.js': null,
    '.github/workflows/ci.yml':
      'on: push\njobs:\n  build:\n    name: "Build and test"\n    steps: []\n  lint:\n    runs-on: x\n    steps:\n      - name: not a job\n',
  }

  test('늘 볼 경로, 폴더에서 고른 경계, CI 작업 이름이 후보로 나온다(셋까지)', () => {
    const q = plan(files).questions
    expect(q.map((x) => x.id)).toEqual(['human_paths', 'boundaries', 'ci_checks'])
    expect(q[0]?.options.map((o) => o.value)).toEqual(['db/migrations/**', 'src/auth/**'])
    expect(q[1]?.options).toEqual([{ value: 'src/ui:src/db', label: 'src/ui → src/db' }])
    expect(q[2]?.options.map((o) => o.value)).toEqual(['Build and test', 'lint'])
    // 경계 후보도 CI도 없으면 늘 볼 경로만 묻는다
    expect(plan({ 'a.py': null }).questions.map((x) => x.id)).toEqual(['human_paths'])
  })

  test('워크플로의 작업 이름: 식이 든 이름은 뺀다', () => {
    expect(
      workflowJobs('jobs:\n  a:\n    name: ${{ matrix.os }}\n  b:\n    runs-on: x\nother: 1\n'),
    ).toEqual(['b'])
    expect(workflowJobs('name: x\n')).toEqual([])
  })

  test('답 넣기: human_paths, 경계 래칫, ci_checks. 같은 답은 한 번. 깨진 답은 던진다', () => {
    const q = plan(files).config
    const out = applyAnswers(q, {
      human_paths: ['db/migrations/**', ' db/migrations/** ', ''],
      boundaries: ['src/ui:src/db', 'src/ui:src/db'],
      ci_checks: ['Build and test'],
    })
    expect(out.human_paths).toEqual(['db/migrations/**'])
    expect(out.commands.full).toEqual({ ci_checks: ['Build and test'] })
    expect(out.ratchets.at(-1)).toEqual(boundaryRatchet('src/ui:src/db'))
    expect(q.human_paths).toEqual([])
    expect(() => applyAnswers(q, { boundaries: ['src/ui'] })).toThrow(/앞 폴더:뒤 폴더/)
    expect(() => applyAnswers(q, { boundaries: ["a:b'; rm -rf ~"] })).toThrow(/앞 폴더:뒤 폴더/)
    expect(() => applyAnswers(q, { human_paths: ['/etc/**'] })).toThrow(/품질 기준으로 읽히지 않음/)
  })

  test('경계 래칫: 앞 폴더에서 뒤 폴더 이름을 가져오는 줄을 git grep으로 센다', () => {
    const r = boundaryRatchet('src/ui:src/db')
    expect(r).toMatchObject({ id: 'boundary-ui-db', kind: 'command', better: 'lower' })
    expect(r.run).toMatch(/^git grep -h -I -E '.+' -- 'src\/ui\/' \| wc -l$/)
    const re = new RegExp(
      (/-E '([^']+)'/.exec(r.run)?.[1] ?? '').replace(/\[\[:space:\]\]/g, '\\s'),
    )
    for (const line of [
      "import { q } from '../db/query'",
      'from app.db import models',
      'from ..db import x',
      'import com.acme.db.Repo;',
      'use crate::db::Pool;',
      'const db = require("../db")',
      '\t"example.com/app/db"',
    ])
      expect(re.test(line), line).toBe(true)
    for (const line of ["import { dbx } from '../dbx'", 'const db = 1', '// db here'])
      expect(re.test(line), line).toBe(false)
  })
})
