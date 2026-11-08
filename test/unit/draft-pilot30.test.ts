// [단위] 시범 30개 레포에서 찾은 문제 7~11의 초안(V69·V70)과 드라이런의 환경 탓 가르기(V72).
// docs/experiments/quality-floor-pilot/report.md '새로 찾은 relay 문제'.
// 매니페스트는 시범 레포의 파일 그대로다(test/fixtures/draft-repos/<레포>/, 파일 목록은 <레포>.files: 루트 파일, 매니페스트,
// 소스 몇 개). 드라이런으로 실제 도구를 돌리는 것은 [어댑터] draft-dry-run.test.ts, 시험 결과 읽기(문제 12)는 test-report.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseQuality } from '../../src/core/quality.ts'
import { planDraft, type DraftPlan } from '../../src/engine/draft.ts'
import { environmentCause } from '../../src/engine/dry-run.ts'
import { summaryLines } from '../../src/engine/init.ts'
import {
  chooseBundles,
  narrowRequirements,
  readPyproject,
  requirementNames,
} from '../../src/engine/python-deps.ts'
import { appliedPlugins, catalogPlugins, mergeJUnit, unitDirs } from '../../src/engine/recipes.ts'
import { tomlEntries } from '../../src/engine/toml-lite.ts'

const ROOT = fileURLToPath(new URL('../fixtures/draft-repos/', import.meta.url))

/** 시범 레포의 파일 목록과 매니페스트 글 */
function repo(name: string): { files: string[]; texts: Map<string, string> } {
  const files = readFileSync(join(ROOT, `${name}.files`), 'utf8')
    .split('\n')
    .filter(Boolean)
  const texts = new Map<string, string>()
  const walk = (dir: string, pre: string) => {
    for (const n of readdirSync(dir)) {
      const full = join(dir, n)
      if (statSync(full).isDirectory()) walk(full, `${pre}${n}/`)
      else texts.set(`${pre}${n}`, readFileSync(full, 'utf8'))
    }
  }
  if (existsSync(join(ROOT, name))) walk(join(ROOT, name), '')
  return { files: [...new Set([...files, ...texts.keys()])], texts }
}

function plan(files: string[], texts: ReadonlyMap<string, string>): DraftPlan {
  const out = planDraft({ files, texts })
  const parsed = parseQuality(JSON.stringify(out.config))
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return out
}
const planOf = (name: string) => {
  const r = repo(name)
  return plan(r.files, r.texts)
}
/** 글만으로 짠 초안(파일 목록은 글의 열쇠와 more) */
const planTexts = (texts: Record<string, string>, more: string[] = []) =>
  plan([...Object.keys(texts), ...more], new Map(Object.entries(texts)))

describe('문제 7: Python 도구는 setup이 실제로 까는 묶음에 있을 때만', () => {
  test('tenacity: pytest·ruff·mypy가 PEP 735 dev 묶음에 있어 pip을 올리고 --group dev를 깐다. [tool.mypy] files면 mypy는 대상 없이', () => {
    const p = planOf('jd_tenacity')
    expect(p.units).toEqual([{ label: 'Python (pip)', dir: '.' }])
    expect(p.config.setup).toEqual({
      run: "python3 -m venv .venv && .venv/bin/python -m pip install 'pip>=25.1' && .venv/bin/pip install -e . --group dev",
      inputs: ['pyproject.toml'],
      keep: ['.venv'],
    })
    expect(p.config.commands).toEqual({
      fast: [
        { id: 'lint', run: '.venv/bin/ruff check .' },
        { id: 'types', run: '.venv/bin/mypy' },
      ],
      acceptance: {
        id: 'test',
        run: '.venv/bin/pytest --junitxml=.relay-out/junit.xml',
        junit: '.relay-out/junit.xml',
      },
    })
    expect(p.suggestions).toEqual([
      'pytest-cov를 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
      'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다',
    ])
  })

  test('pip: 같은 도구를 담으면 extra를 고른다(pip을 올리지 않는다). 도구가 어느 묶음에도 없으면 넣지 않고 제안', () => {
    const p = planTexts(
      {
        'pyproject.toml':
          '[project]\nname = "app"\n\n[project.optional-dependencies]\ntest = ["pytest", "ruff"]\n\n[dependency-groups]\ndev = ["pytest", "ruff"]\n\n[tool.mypy]\nstrict = true\n',
      },
      ['app/__init__.py'],
    )
    expect(p.config.setup?.run).toBe("python3 -m venv .venv && .venv/bin/pip install -e '.[test]'")
    // mypy는 설정([tool.mypy])만 있고 의존성이 아니다
    expect(p.config.commands.fast).toEqual([{ id: 'lint', run: '.venv/bin/ruff check .' }])
  })

  test('uv: 기본 묶음(default-groups, 없으면 dev)에 없는 묶음은 --group, extra는 --extra', () => {
    // itsdangerous: default-groups가 tests·typing·dev를 모두 담아 uv sync 그대로. [tool.mypy] files가 있어 mypy는 대상 없이
    const its = planOf('itsdangerous')
    expect(its.config.setup?.run).toBe('uv sync')
    expect(its.config.commands.fast.map((c) => c.run)).toEqual([
      'uv run ruff check .',
      'uv run mypy',
    ])
    expect(its.config.commands.acceptance?.run).toBe(
      'uv run pytest --junitxml=.relay-out/junit.xml',
    )
    const groups = planTexts(
      {
        'pyproject.toml':
          '[project]\nname = "a"\n\n[dependency-groups]\ndev = ["ruff"]\ntests = ["pytest", "pytest-cov"]\ntyping = ["mypy", { include-group = "tests" }]\n\n[project.optional-dependencies]\nlint = ["radon"]\n',
      },
      ['uv.lock', 'a.py'],
    )
    // typing이 include-group으로 tests를 담아 pytest·pytest-cov·mypy 셋을 채운다
    expect(groups.config.setup?.run).toBe('uv sync --extra lint --group typing')
    expect(groups.config.commands.acceptance?.run).toMatch(/--cov=\. /)
    expect(groups.config.ratchets.map((r) => r.id)).toContain('complexity')
  })

  test('poetry: optional 묶음은 --with, extra는 -E. optional이 아닌 묶음과 PEP 735 묶음은 poetry install이 깐다', () => {
    const p = planTexts(
      {
        'pyproject.toml': [
          '[tool.poetry]\nname = "x"\n',
          '[tool.poetry.dependencies]\npython = "^3.10"\n',
          '[tool.poetry.group.test.dependencies]\npytest = "^8"\n',
          '[tool.poetry.group.lint]\noptional = true\n\n[tool.poetry.group.lint.dependencies]\nruff = "*"\n',
          '[tool.poetry.extras]\ncov = ["pytest-cov"]\n',
          '[dependency-groups]\ntyping = ["mypy"]\n',
        ].join('\n'),
      },
      ['poetry.lock', 'x/__init__.py'],
    )
    expect(p.config.setup?.run).toBe('poetry install -E cov --with lint')
    expect(p.config.commands.fast.map((c) => c.id)).toEqual(['lint', 'types'])
  })

  test('묶음 고르기: 칸마다 남은 칸을 가장 많이 채우는 묶음, 대안(ruff 없으면 flake8)은 앞 칸이 비었을 때만', () => {
    const b = (name: string, ...deps: string[]) => ({ kind: 'group' as const, name, deps })
    const r = chooseBundles(
      ['flake8'],
      [b('lint', 'ruff'), b('t', 'pytest'), b('all', 'pytest', 'mypy')],
      [['pytest'], ['ruff', 'flake8'], ['mypy']],
    )
    expect(r.chosen.map((x) => x.name)).toEqual(['all'])
    expect([r.has('pytest'), r.has('mypy'), r.has('ruff'), r.has('flake8')]).toEqual([
      true,
      true,
      false,
      true,
    ])
  })

  test('pyproject 읽기: extra가 제 꾸러미의 extra를 부름, poetry 옛 dev-dependencies, uv dev-dependencies', () => {
    const py = readPyproject(
      '[project]\nname = "My_App"\n[project.optional-dependencies]\nlint = ["Ruff>=0.5"]\ndev = ["my-app[lint]", "pytest; python_version > \'3.8\'"]\n[tool.uv]\ndev-dependencies = ["mypy"]\n',
    )
    expect(py.extras.get('dev')).toEqual(['ruff', 'pytest'])
    expect(py.groups.get('dev')).toEqual(['mypy'])
    expect(readPyproject('[tool.poetry.dev-dependencies]\nPyTest = "^7"\n').poetryMain).toEqual([
      'pytest',
    ])
  })
})

describe('문제 8: 이름이 좁은 쓰임을 말하는 requirements는 설치 본이 아니다', () => {
  test('humanize: requirements-mypy.txt를 고르지 않고 시험 extra를 깐다. pytest-cov가 깔려 --cov를 붙이고, mypy는 그 파일에만 있다고 제안', () => {
    const p = planOf('python-humanize_humanize')
    expect(p.config.setup).toEqual({
      run: "python3 -m venv .venv && .venv/bin/pip install -e '.[tests]'",
      inputs: ['pyproject.toml'],
      keep: ['.venv'],
    })
    expect(p.config.commands.fast).toEqual([])
    expect(p.config.commands.acceptance?.run).toBe(
      '.venv/bin/pytest --junitxml=.relay-out/junit.xml --cov=. --cov-report=xml:.relay-out/coverage.xml',
    )
    expect(p.config.ratchets.map((r) => r.id)).toContain('diff-coverage')
    expect(p.suggestions).toEqual([
      'ruff를 dev 의존성에 더하면 빠른 검사(lint)를 쓸 수 있습니다',
      'mypy: requirements-mypy.txt에만 있어 setup이 깔지 않습니다. setup이 까는 묶음(시험 extra나 dev 묶음)에 더하면 형 검사(types)를 쓸 수 있습니다',
      'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다',
    ])
  })

  test('requirements만: 설치 본(requirements.txt, -test)을 깔고 좁은 것은 뺀다. pytest-cov가 없으면 --cov를 붙이지 않는다', () => {
    const p = planTexts({
      'requirements.txt': 'flask\n',
      'requirements-test.txt': '-r requirements.txt\npytest\n',
      'requirements-docs.txt': 'sphinx\npytest-cov\n',
      'requirements-dev-tools.txt': 'ruff\n',
    })
    expect(p.config.setup).toEqual({
      run: 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-test.txt',
      inputs: ['requirements.txt', 'requirements-test.txt'],
      keep: ['.venv'],
    })
    expect(p.config.commands.acceptance?.run).toBe(
      '.venv/bin/pytest --junitxml=.relay-out/junit.xml',
    )
    expect(p.config.commands.fast).toEqual([])
    expect(p.suggestions.slice(0, 2)).toEqual([
      'ruff: requirements-dev-tools.txt에만 있어 setup이 깔지 않습니다. setup이 까는 묶음(시험 extra나 dev 묶음)에 더하면 빠른 검사(lint)를 쓸 수 있습니다',
      'pytest-cov: requirements-docs.txt에만 있어 setup이 깔지 않습니다. setup이 까는 묶음(시험 extra나 dev 묶음)에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    ])
  })

  test('좁은 requirements만 있으면 설치를 고르지 않고 단위와 제안만', () => {
    const p = planTexts({ 'requirements-mypy.txt': 'mypy\npytest\n' }, ['a.py'])
    expect(p.units).toEqual([{ label: 'Python (pip)', dir: '.' }])
    expect(p.config.setup).toBeUndefined()
    expect(p.config.commands.fast).toEqual([])
    expect(p.suggestions[0]).toMatch(/^requirements가 좁은 쓰임\(requirements-mypy\.txt\)뿐이라/)
  })

  test('이름 가르기와 -r 따라가기', () => {
    const narrow = ['requirements-mypy.txt', 'requirements_docs.txt', 'requirements-lint.txt']
    const wide = [
      'requirements.txt',
      'requirements-test.txt',
      'requirements-dev.txt',
      'requirements-ci.txt',
    ]
    expect(
      narrow
        .concat('requirements-typing.txt', 'requirements-dev-tools.txt')
        .map(narrowRequirements),
    ).toEqual([true, true, true, true, true])
    expect(wide.map(narrowRequirements)).toEqual([false, false, false, false])
    const texts = new Map([
      ['req/a.txt', '-r b.txt\nPytest_Cov==5 # cov\n--index-url x\n'],
      ['req/b.txt', '-r a.txt\nruff\n'],
    ])
    expect(requirementNames('req/a.txt', texts)).toEqual(['ruff', 'pytest-cov'])
  })
})

describe('문제 9: go.mod 없는 Go 레포', () => {
  test('pkg/errors: Go로 알아보지만 명령은 넣지 않고(레포를 바꾸지 않음) go mod init을 제안. 앱이 재는 래칫은 그대로', () => {
    const p = planOf('pkg_errors')
    expect(p.units).toEqual([{ label: 'Go (go.mod 없음)', dir: '.' }])
    expect(p.config.setup).toBeUndefined()
    expect(p.config.commands).toEqual({ fast: [] })
    expect(p.config.ratchets.map((r) => r.id)).toEqual(['file-size', 'suppressions', 'duplication'])
    expect(p.suggestions).toEqual([
      'go.mod가 없는 Go 레포라 go vet·go test를 고르지 않았습니다: go mod init <모듈 경로>로 go.mod를 커밋하는 Work를 만들면 수용 시험과 시험 수 래칫을 쓸 수 있습니다',
    ])
  })

  test('루트의 .go 파일만 본다. go.mod가 어디든 있으면 그 단위', () => {
    expect(unitDirs(['a.go']).dirs).toEqual([{ lang: 'go', dir: '.' }])
    expect(unitDirs(['cmd/a.go']).dirs).toEqual([])
    expect(unitDirs(['a.go', 'svc/go.mod']).dirs).toEqual([{ lang: 'go', dir: 'svc' }])
  })
})

describe('문제 10: 여러 모듈 Maven', () => {
  test('gson: 빠른 검사와 수용 시험이 verify까지(모듈 사이의 jar를 reactor가 만든다. install은 ~/.m2에 써서 쓰지 않음)', () => {
    const p = planOf('google_gson')
    expect(p.units).toEqual([{ label: 'Java (Maven, 여러 모듈)', dir: '.' }])
    expect(p.config.commands.fast[0]).toEqual({
      id: 'compile',
      run: 'mvn -B -q -DskipTests verify',
    })
    expect(p.config.commands.acceptance).toEqual({
      id: 'test',
      run: `mvn -B verify; s=$?; ${mergeJUnit('target/surefire-reports')}; exit $s`,
      junit: '.relay-out/junit.xml',
    })
  })
})

describe('문제 11: Kotlin 멀티플랫폼', () => {
  test('turbine: 판 목록의 별칭으로 멀티플랫폼을 알아보고 jvmTestClasses·jvmTest, 결과는 build/test-results/jvmTest', () => {
    const p = planOf('cashapp_turbine')
    expect(p.units).toEqual([{ label: 'Kotlin (Gradle, 멀티플랫폼)', dir: '.' }])
    expect(p.config.commands.fast).toEqual([
      { id: 'compile', run: './gradlew --no-daemon -q jvmTestClasses' },
    ])
    expect(p.config.commands.acceptance?.run).toBe(
      `./gradlew --no-daemon jvmTest; s=$?; ${mergeJUnit('build/test-results/jvmTest')}; exit $s`,
    )
  })

  test('kotlinpoet: 루트는 apply false, kotlinpoet은 멀티플랫폼, interop은 kotlin("jvm")이라 두 작업 모두', () => {
    const p = planOf('kotlinpoet')
    expect(p.config.commands.fast[0]?.run).toBe(
      './gradlew --no-daemon -q testClasses jvmTestClasses',
    )
    const results = ['build/test-results/test', 'build/test-results/jvmTest']
    expect(p.config.commands.acceptance?.run).toBe(
      `./gradlew --no-daemon test jvmTest; s=$?; ${mergeJUnit(results)}; exit $s`,
    )
    expect(mergeJUnit(results)).toContain(
      "find . \\( -path '*/build/test-results/test/TEST-*.xml' -o -path '*/build/test-results/jvmTest/TEST-*.xml' \\)",
    )
  })

  test('jvm 대상이 없는 멀티플랫폼은 명령 없이 제안. 멀티플랫폼이 없으면 전과 같다', () => {
    const p = planTexts(
      {
        'build.gradle.kts':
          'plugins {\n  kotlin("multiplatform")\n}\nkotlin {\n  js { nodejs() }\n}\n',
      },
      ['gradlew'],
    )
    expect(p.config.commands.fast).toEqual([])
    expect(p.suggestions[0]).toMatch(/jvm 대상이 없어/)
    const jvm = planTexts({ 'build.gradle.kts': 'plugins {\n  kotlin("jvm")\n}\n' }, ['gradlew'])
    expect(jvm.config.commands.fast[0]?.run).toBe('./gradlew --no-daemon -q testClasses')
  })

  test('플러그인 읽기: kotlin("…"), id, 별칭, apply plugin, 맨 이름. apply false는 뺀다', () => {
    const catalog = catalogPlugins(
      '[plugins]\nkotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "k" }\nshort = "org.jetbrains.kotlin.jvm:2.0"\n[plugins.long]\nid = "com.example.x"\n',
    )
    expect([...catalog]).toEqual([
      ['kotlin.multiplatform', 'org.jetbrains.kotlin.multiplatform'],
      ['short', 'org.jetbrains.kotlin.jvm'],
      ['long', 'com.example.x'],
    ])
    const build = [
      'plugins {',
      '  alias(libs.plugins.kotlin.multiplatform) apply false',
      '  alias(libs.plugins.short)',
      "  id 'java-library'",
      '  `application`',
      '}',
      "apply plugin: 'kotlin-multiplatform' // 옛 꼴",
    ].join('\n')
    expect([...appliedPlugins(build, catalog)].sort()).toEqual([
      'application',
      'java-library',
      'org.jetbrains.kotlin.jvm',
      'org.jetbrains.kotlin.multiplatform',
    ])
  })
})

describe('작은 TOML 읽개', () => {
  test('표 머리, 점 열쇠, 따옴표 열쇠, 여러 줄 배열, 세 겹 따옴표 글 속의 [표] 꼴 줄, 주석 속 괄호', () => {
    const text = [
      '[project]',
      'readme.text = """',
      '[not.a.table]',
      'x = 1',
      '"""',
      'urls."Issue tracker" = "u" # [주석]',
      'optional-dependencies.tests = [',
      '  "pytest>=9",  # ]',
      "  'pytest-cov',",
      ']',
      '[ "tool" . poetry ]',
      'name = "a"',
    ].join('\n')
    expect(tomlEntries(text)).toEqual([
      { path: ['project', 'readme', 'text'], value: '""' },
      { path: ['project', 'urls', 'Issue tracker'], value: '"u"' },
      {
        path: ['project', 'optional-dependencies', 'tests'],
        value: '[\n  "pytest>=9",  \n  \'pytest-cov\',\n]',
      },
      { path: ['tool', 'poetry', 'name'], value: '"a"' },
    ])
  })
})

describe('드라이런의 환경 탓 가르기 (사용자 결정 2026-11-08: 끄는 조건의 분모에서 뺀다)', () => {
  test('네트워크·플러그인 저장소·JDK 판의 무늬는 환경, 고른 명령이나 레포 코드의 실패는 아니다', () => {
    const cases: [string, string | null][] = [
      [
        "Plugin [id: 'com.vanniktech.maven.publish', version: '0.36.0'] was not found in any of the following sources:",
        'Gradle 플러그인 저장소',
      ],
      ['BUG! exception in phase: Unsupported class file major version 65', 'JDK 판'],
      [
        "> Could not GET 'https://plugins.gradle.org/m2/x.pom'. Received status code 403 from server",
        '네트워크',
      ],
      ['java.net.UnknownHostException: repo.maven.apache.org', '네트워크'],
      ["> Could not resolve all files for configuration ':classpath'.", '받기 실패(Gradle)'],
      ['> Could not resolve org.jetbrains.kotlin:kotlin-stdlib:2.0.0.', '받기 실패(Gradle)'],
      // relay(고른 명령)나 레포(코드)의 실패: 시범의 gson, humanize
      ['[ERROR] module-info.java:[19,22] module not found: com.google.gson', null],
      [
        '[ERROR] Failed to execute goal on project test-jpms: Could not resolve dependencies for project com.google.code.gson:test-jpms:jar:2.15.1-SNAPSHOT',
        null,
      ],
      [
        'ERROR: usage: pytest [options] [file_or_dir]: error: unrecognized arguments: --cov=.',
        null,
      ],
      ['error[E0425]: cannot find value `x` in this scope', null],
    ]
    for (const [text, want] of cases) expect(environmentCause(text), text).toBe(want)
  })

  test('요약: 안 된 명령 옆에 환경 탓 표시, 고칠 것의 가름(환경 탓 수와 나머지)', () => {
    const env = {
      id: 'compile',
      kind: 'fast' as const,
      run: './gradlew -q testClasses',
      ok: false,
      reason: '종료 코드 1: BUILD FAILED',
      environment: 'Gradle 플러그인 저장소',
    }
    const repoFail = {
      id: 'lint',
      kind: 'fast' as const,
      run: 'x',
      ok: false,
      reason: '종료 코드 1: E',
    }
    const q = planTexts({ 'build.gradle': "plugins { id 'java' }\n" }).config
    const lines = summaryLines({
      plan: { config: q, units: [], questions: [], suggestions: [] },
      dry: {
        head: 'a'.repeat(40),
        commands: [env, repoFail],
        values: [],
        config: q,
        fixes: [env, repoFail],
      },
      config: q,
      exists: false,
    })
    expect(lines).toContain(
      '  안 됨 compile: ./gradlew -q testClasses — 종료 코드 1: BUILD FAILED [환경 탓으로 보임: Gradle 플러그인 저장소]',
    )
    expect(lines).toContain(
      '  가름: 환경 탓으로 보임 1, 나머지 1(relay 탓인지 레포 탓인지는 사람이 가름)',
    )
  })
})
