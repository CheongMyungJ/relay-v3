// 매니페스트(manifests.ts)를 detectSignals를 거쳐 본다: 새 의존성, 출처 바뀜, 명령 정의·시험 설정 바뀜.
import { describe, expect, test } from 'vitest'
import { DEFAULT_TEST_GLOBS } from '../../src/core/quality.ts'
import { detectSignals, type ManifestPair } from '../../src/core/signals.ts'
import type { FileChange, QualityConfig, Signal } from '../../src/core/types.ts'

function quality(over: Partial<QualityConfig> = {}): QualityConfig {
  return {
    version: 1,
    commands: { fast: [] },
    human_paths: [],
    guard_paths: [],
    public_api: [],
    test_globs: DEFAULT_TEST_GLOBS,
    examples_dir: '.relay/examples',
    ratchets: [],
    rules: [],
    auto: [],
    ...over,
  }
}

function change(path: string, over: Partial<FileChange> = {}): FileChange {
  return {
    path,
    status: 'M',
    added: over.added_lines?.length ?? 0,
    deleted: over.removed_lines?.length ?? 0,
    binary: false,
    added_lines: [],
    removed_lines: [],
    ...over,
  }
}

interface Input {
  files?: FileChange[]
  quality?: QualityConfig
  baseDirs?: string[]
  manifests?: ManifestPair[]
}

function detect(input: Input) {
  return detectSignals({
    diff: { base: 'b', head: 'h', files: input.files ?? [] },
    quality: input.quality ?? quality(),
    baseDirs: new Set(input.baseDirs ?? ['src', 'src/core', 'test', 'docs']),
    manifests: input.manifests ?? [],
  })
}

function only(kind: Signal['kind'], input: Input): Signal[] {
  return detect(input).signals.filter((s) => s.kind === kind)
}

describe('구조 변경: 새 의존성', () => {
  function deps(manifests: ManifestPair[]) {
    const r = detect({ manifests })
    return { names: r.new_dependencies, signals: r.signals }
  }

  test('package.json 네 칸의 새 키를 새 의존성으로 본다', () => {
    const base = JSON.stringify({ dependencies: { a: '1' }, devDependencies: { b: '1' } })
    const head = JSON.stringify({
      name: 'x',
      dependencies: { a: '2', c: '1' },
      devDependencies: { b: '1', d: '1' },
      peerDependencies: { e: '1' },
      optionalDependencies: { f: '1' },
    })
    const r = deps([{ path: 'package.json', base, head }])
    expect(r.names).toEqual(['c', 'd', 'e', 'f'])
    expect(r.signals).toEqual([
      { kind: 'structure_change', path: 'package.json', detail: '새 의존성: c, d, e, f' },
    ])
  })

  test('판 올림이나 칸 옮김은 새 의존성이 아니다', () => {
    const base = JSON.stringify({ dependencies: { a: '1' } })
    const head = JSON.stringify({ devDependencies: { a: '2' } })
    expect(deps([{ path: 'package.json', base, head }]).names).toEqual([])
  })

  test('새 매니페스트는 모든 의존성이 새것이다', () => {
    const head = JSON.stringify({ dependencies: { a: '1' } })
    expect(deps([{ path: 'packages/x/package.json', base: null, head }]).names).toEqual(['a'])
  })

  test('지운 매니페스트는 새 의존성이 없다', () => {
    const base = JSON.stringify({ dependencies: { a: '1' } })
    expect(deps([{ path: 'package.json', base, head: null }]).signals).toEqual([])
  })

  test('읽지 못하는 package.json은 의존성이 없는 것으로 본다', () => {
    const good = JSON.stringify({ dependencies: { a: '1' } })
    expect(deps([{ path: 'package.json', base: good, head: '{' }]).names).toEqual([])
    expect(deps([{ path: 'package.json', base: '[1]', head: good }]).names).toEqual(['a'])
  })

  test('requirements는 주석·빈 줄·다른 요구 파일·해시를 빼고 이름을 맞춰 읽는다', () => {
    const base = ['Django==4.2', 'foo_bar>=1  # 주석', ''].join('\n')
    const head = [
      '# 머리 주석',
      'django==5.0',
      'Foo.Bar>=2',
      'requests[socks]>=2.31 ; python_version >= "3.8"',
      '-r other.txt',
      '-c constraints.txt',
      '--hash=sha256:abc',
      'mypkg @ https://example.com/mypkg.zip',
      'numpy==1.0 \\',
      '    --hash=sha256:def',
    ].join('\r\n')
    const r = deps([{ path: 'requirements-dev.txt', base, head }])
    expect(r.names).toEqual(['requests', 'mypkg', 'numpy'])
  })

  test('requirements의 VCS·주소·옵션 줄은 #egg= 이름이나 줄 자체를 새 의존성으로 센다', () => {
    const head = [
      '-e git+https://github.com/x/y.git#egg=Y_Pkg',
      'https://x.org/pkg.whl',
      '-e .',
      '--extra-index-url https://evil.example/simple',
    ].join('\n')
    const r = deps([{ path: 'requirements.txt', base: '', head }])
    expect(r.names).toEqual([
      'y-pkg',
      'https://x.org/pkg.whl',
      '-e .',
      '--extra-index-url https://evil.example/simple',
    ])
  })

  test('pyproject [project] 안의 인라인 optional-dependencies 표도 읽는다', () => {
    const base = '[project]\nname = "x"\ndependencies = []\n'
    const head = `[project]
name = "x"
dependencies = []
optional-dependencies = { dev = ["pytest>=8", "Ruff"], docs = ["mkdocs"] }
`
    expect(deps([{ path: 'pyproject.toml', base, head }]).names).toEqual([
      'pytest',
      'ruff',
      'mkdocs',
    ])
  })

  test('있던 의존성의 출처를 레지스트리 밖으로 바꾸면 구조 변경이다', () => {
    const base = JSON.stringify({ dependencies: { a: '^1.0.0', b: '1', c: '1', d: '1' } })
    const head = JSON.stringify({
      dependencies: { a: 'npm:evil-a@1.0.0', b: 'github:x/b', c: '2', d: 'x/d#main' },
    })
    const r = deps([{ path: 'package.json', base, head }])
    expect(r.names).toEqual(['a', 'b', 'd'])
    expect(r.signals).toEqual([
      {
        kind: 'structure_change',
        path: 'package.json',
        detail: '의존성 출처가 바뀜: a → npm:evil-a@1.0.0, b → github:x/b, d → x/d#main',
      },
    ])
  })

  test('레지스트리 안에서 판만 올리거나 범위를 바꾸면 출처 바뀜이 아니다', () => {
    const base = JSON.stringify({ dependencies: { a: '^1.0.0', '@s/b': '1' } })
    const head = JSON.stringify({ dependencies: { a: '>=1 <3', '@s/b': 'latest' } })
    expect(deps([{ path: 'package.json', base, head }]).signals).toEqual([])
  })

  test('go.mod는 require의 모듈 경로를 읽는다', () => {
    const base = 'module x\n\nrequire example.com/a v1.0.0\n'
    const head = `module x
go 1.22
require example.com/a v1.2.0
require (
\tgithub.com/b/c v0.1.0
\tgolang.org/x/d v0.2.0 // indirect
)
replace example.com/z => ../z`
    const names = deps([{ path: 'go.mod', base, head }]).names
    expect(names).toEqual(['github.com/b/c', 'golang.org/x/d'])
  })

  test('Cargo.toml은 의존성 표의 키와 하위 표 이름을 읽는다', () => {
    const base = '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n'
    const head = `[package]
name = "x"
version = "0.1.0"
[dependencies]
serde = { version = "1", features = ["derive"] }
tokio.workspace = true
"quoted-name" = "0.1" # 주석
[dev-dependencies]
proptest = "1"
[build-dependencies]
cc = "1"
[target.'cfg(unix)'.dependencies]
libc = "0.2"
[dependencies.regex]
version = "1"
features = [
  "unicode",
]
[features]
default = ["std"]`
    const names = deps([{ path: 'crates/x/Cargo.toml', base, head }]).names
    expect(names).toEqual(['regex', 'tokio', 'quoted-name', 'proptest', 'cc', 'libc'])
  })

  test('여러 줄 값 속의 키는 의존성으로 읽지 않는다', () => {
    const head = '[dependencies]\nserde = {\n  version = "1",\n  default-features = false\n}\n'
    expect(deps([{ path: 'Cargo.toml', base: null, head }]).names).toEqual(['serde'])
  })

  test('pyproject.toml은 PEP 621 배열과 Poetry 표를 읽는다', () => {
    const base = '[project]\nname = "x"\ndependencies = ["requests>=2"]\n'
    const head = `[project]
name = "x"
description = """
[tool.poetry.dependencies]
fake = "1"
"""
dependencies = [
  "Requests>=2",
  'httpx[http2]>=0.27',
]
[project.optional-dependencies]
test = ["pytest>=8", "pytest-cov"]
[dependency-groups]
lint = ["ruff", {include-group = "test"}]
[tool.poetry.dependencies]
python = "^3.11"
Flask = { version = "^3" }
[tool.poetry.group.dev.dependencies]
black = "^24"
[build-system]
requires = ["hatchling"]`
    const names = deps([{ path: 'pyproject.toml', base, head }]).names
    expect(names).toEqual(['httpx', 'pytest', 'pytest-cov', 'ruff', 'flask', 'black'])
  })

  test('모르는 매니페스트 이름은 읽지 않는다', () => {
    expect(deps([{ path: 'deps.json', base: null, head: '{"dependencies":{"a":"1"}}' }])).toEqual({
      names: [],
      signals: [],
    })
  })

  test('여러 매니페스트의 같은 새 이름은 한 번만 센다', () => {
    const head = JSON.stringify({ dependencies: { lodash: '4' } })
    const r = deps([
      { path: 'a/package.json', base: '{}', head },
      { path: 'b/package.json', base: '{}', head },
    ])
    expect(r.names).toEqual(['lodash'])
    expect(r.signals.map((s) => s.path)).toEqual(['a/package.json', 'b/package.json'])
  })

  test('새 의존성이 많으면 다섯 개만 적고 수를 붙인다', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const head = JSON.stringify({ dependencies: Object.fromEntries(names.map((n) => [n, '1'])) })
    const r = deps([{ path: 'package.json', base: '{}', head }])
    expect(r.names).toEqual(names)
    expect(r.signals[0]?.detail).toBe('새 의존성: a, b, c, d, e 외 2개')
  })
})

describe('지킴: 명령 정의와 시험 설정', () => {
  const guard = (manifests: ManifestPair[]) => only('guard_path', { manifests })

  test('package.json의 scripts가 바뀌면 지킴 파일 신호다(npm run lint의 뜻이 바뀜)', () => {
    const base = JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest' } })
    const head = JSON.stringify({ scripts: { lint: 'true', test: 'vitest' } })
    expect(guard([{ path: 'package.json', base, head }])).toEqual([
      {
        kind: 'guard_path',
        path: 'package.json',
        detail: '명령 정의(scripts)가 바뀜: scripts.lint',
      },
    ])
  })

  test('스크립트를 더하거나 지워도 신호다(pre·post 스크립트도 명령을 바꾼다)', () => {
    const base = JSON.stringify({ scripts: { test: 'vitest', old: 'x' } })
    const head = JSON.stringify({ scripts: { test: 'vitest', pretest: 'exit 0' } })
    expect(guard([{ path: 'package.json', base, head }])[0]?.detail).toBe(
      '명령 정의(scripts)가 바뀜: scripts.old, scripts.pretest',
    )
  })

  test('package.json을 지우면 scripts가 사라진 것이라 신호다', () => {
    const base = JSON.stringify({ scripts: { test: 'vitest' } })
    expect(guard([{ path: 'package.json', base, head: null }])).toHaveLength(1)
  })

  test('scripts가 그대로면 신호가 없다', () => {
    const base = JSON.stringify({ scripts: { test: 'vitest' }, version: '1.0.0' })
    const head = JSON.stringify({ version: '1.0.1', scripts: { test: 'vitest' } })
    expect(guard([{ path: 'package.json', base, head }])).toEqual([])
  })

  test('새 package.json은 scripts를 견줄 기준이 없다(새 모듈·의존성 신호가 본다)', () => {
    const head = JSON.stringify({ scripts: { test: 'x' } })
    expect(guard([{ path: 'packages/a/package.json', base: null, head }])).toEqual([])
  })

  test('pyproject의 [tool.pytest] 설정이 바뀌면 신호다', () => {
    const base = '[tool.pytest.ini_options]\naddopts = "-q"\n[project]\nname = "x"\n'
    const head = '[tool.pytest.ini_options]\naddopts = "-q -k not_slow"\n[project]\nname = "x"\n'
    expect(guard([{ path: 'pyproject.toml', base, head }])).toEqual([
      { kind: 'guard_path', path: 'pyproject.toml', detail: '시험 설정([tool.pytest])이 바뀜' },
    ])
  })

  test('pyproject의 다른 표만 바뀌면 신호가 없다', () => {
    const base = '[tool.pytest.ini_options]\naddopts = "-q"\n[project]\nversion = "1"\n'
    const head = '[tool.pytest.ini_options]\naddopts = "-q"\n[project]\nversion = "2"\n'
    expect(guard([{ path: 'pyproject.toml', base, head }])).toEqual([])
  })

  test('지킴 신호는 경로 신호 뒤, 시험 약화 앞에 온다', () => {
    const base = JSON.stringify({ scripts: { lint: 'eslint .' } })
    const head = JSON.stringify({ scripts: { lint: 'true' } })
    const r = detect({
      manifests: [{ path: 'package.json', base, head }],
      files: [change('package.json'), change('a.test.ts', { status: 'D' })],
    })
    expect(r.signals.map((s) => s.kind)).toEqual(['guard_path', 'test_weakening'])
  })
})
