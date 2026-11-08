// Python 레시피 (V60, V69): uv, poetry, pip(venv). 도구(pytest, pytest-cov, ruff·flake8, mypy·pyright, import-linter, radon)는
// setup이 실제로 까는 묶음에 있을 때만 쓴다(python-deps.ts). 늘 까는 것에 없으면 그 도구를 담은 extra·group을 setup에 더하고,
// 어디에도 깔 길이 없으면 명령에 넣지 않고 제안 글로 낸다. 순수 함수다.

import { at, JUNIT, namesIn, unit, type RepoScan, type Unit } from './recipe-kit.ts'
import {
  chooseBundles,
  narrowRequirements,
  readPyproject,
  requirementNames,
  type Bundle,
  type Pyproject,
  type Slot,
} from './python-deps.ts'

export const REQUIREMENTS = /^requirements[^/]*\.txt$/

/** pip이 PEP 735 묶음을 까는 판(`pip install --group`, 25.1). venv의 pip이 옛것이면 먼저 올린다 */
export const PIP_GROUP_MIN = '25.1'

type Pm = 'uv' | 'poetry' | 'pip'

/** 고를 도구의 칸(앞이 먼저) */
const SLOTS: readonly Slot[] = [
  ['pytest'],
  ['pytest-cov'],
  ['ruff', 'flake8'],
  ['mypy', 'pyright'],
  ['import-linter'],
  ['radon'],
]

/** 설치 본 requirements(이름이 좁은 쓰임을 말하지 않는 것): requirements.txt, -test(s), -dev가 앞, 나머지는 이름 차례 */
function mainRequirements(names: readonly string[]): string[] {
  const rank = (n: string) =>
    n === 'requirements.txt'
      ? 0
      : /^requirements[-_]tests?\.txt$/.test(n)
        ? 1
        : n === 'requirements-dev.txt'
          ? 2
          : 3
  return names
    .filter((n) => REQUIREMENTS.test(n) && !narrowRequirements(n))
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
}

/** pm마다 setup이 늘 까는 이름과 골라야 까는 묶음 */
function bundlesOf(pm: Pm, py: Pyproject): { always: string[]; optional: Bundle[] } {
  const always = [...py.dependencies]
  const optional: Bundle[] = []
  const extras = [...py.extras].map(([name, deps]): Bundle => ({ kind: 'extra', name, deps }))
  const groups = [...py.groups]
  if (pm === 'uv') {
    const defaults = py.uvDefaultGroups ?? ['dev']
    for (const [name, deps] of groups)
      if (defaults === 'all' || defaults.includes(name)) always.push(...deps)
      else optional.push({ kind: 'group', name, deps })
    optional.push(...extras)
  } else if (pm === 'poetry') {
    // poetry install은 본 의존성, optional이 아닌 묶음, PEP 735 묶음을 깐다. extra는 -E, optional 묶음은 --with
    always.push(...py.poetryMain, ...groups.flatMap(([, deps]) => deps))
    for (const [name, g] of py.poetryGroups)
      if (g.optional) optional.push({ kind: 'poetry-group', name, deps: g.deps })
      else always.push(...g.deps)
    optional.push(...extras)
    for (const [name, deps] of py.poetryExtras)
      if (!py.extras.has(name)) optional.push({ kind: 'extra', name, deps })
  } else {
    // pip: extra는 '.[이름]', PEP 735 묶음은 --group(pip 25.1). extra를 먼저 둔다(pip을 올리지 않아도 된다)
    optional.push(
      ...extras,
      ...groups.map(([name, deps]): Bundle => ({ kind: 'group', name, deps })),
    )
  }
  return { always, optional }
}

const q = (s: string) => (/^[A-Za-z0-9._-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export function pythonUnit(scan: RepoScan, dir: string): Unit | null {
  const names = namesIn(scan.files, dir)
  const text = scan.texts.get(at(dir, 'pyproject.toml')) ?? ''
  const py = readPyproject(text)
  const reqs = [...names].filter((n) => REQUIREMENTS.test(n)).sort()
  const poetry = names.has('poetry.lock') || /^\[tool\.poetry\]/m.test(text)
  const pm: Pm = names.has('uv.lock') ? 'uv' : poetry ? 'poetry' : 'pip'
  // 도구 설정만 있는 pyproject(예: JS 레포의 [tool.ruff])는 Python 단위가 아니다
  if (pm === 'pip' && reqs.length === 0 && !py.project) return null
  const u = unit('py', dir, `Python (${pm})`)
  const main = pm === 'pip' ? mainRequirements(reqs) : []
  const reqDeps = main.flatMap((r) => requirementNames(at(dir, r), scan.texts))
  const { always, optional } = bundlesOf(pm, py)
  const { chosen, has } = chooseBundles([...always, ...reqDeps], optional, SLOTS)
  const extras = chosen.filter((b) => b.kind === 'extra').map((b) => b.name)
  const groups = chosen.filter((b) => b.kind !== 'extra').map((b) => b.name)
  const p = pm === 'uv' ? 'uv run ' : pm === 'poetry' ? 'poetry run ' : '.venv/bin/'
  if (pm === 'uv') {
    const flags = [
      ...extras.map((x) => ` --extra ${q(x)}`),
      ...groups.map((g) => ` --group ${q(g)}`),
    ]
    u.setup = {
      run: `uv sync${flags.join('')}`,
      inputs: ['pyproject.toml', 'uv.lock'],
      keep: ['.venv'],
    }
  } else if (pm === 'poetry') {
    const flags = [...extras.map((x) => ` -E ${q(x)}`), ...groups.map((g) => ` --with ${q(g)}`)]
    const inputs = names.has('poetry.lock') ? ['pyproject.toml', 'poetry.lock'] : ['pyproject.toml']
    u.setup = { run: `poetry install${flags.join('')}`, inputs, keep: ['.venv'] }
  } else if (main.length === 0 && !py.project) {
    // 좁은 쓰임의 requirements만 있다: 설치 본을 고르지 않는다(사람이 고른다)
    u.bare = true
    u.suggestions.push(
      `requirements가 좁은 쓰임(${reqs.join(', ')})뿐이라 설치를 고르지 않았습니다: requirements.txt나 requirements-test.txt를 두면 수용 시험을 쓸 수 있습니다`,
    )
    return u
  } else {
    const parts = main.map((r) => `-r ${r}`)
    if (py.project) parts.push(extras.length === 0 ? '-e .' : `-e '.[${extras.join(',')}]'`)
    parts.push(...groups.map((g) => `--group ${q(g)}`))
    const pip =
      groups.length > 0 ? `.venv/bin/python -m pip install 'pip>=${PIP_GROUP_MIN}' && ` : ''
    u.setup = {
      run: `python3 -m venv .venv && ${pip}.venv/bin/pip install ${parts.join(' ')}`,
      inputs: [...(py.project || groups.length > 0 ? ['pyproject.toml'] : []), ...main],
      keep: ['.venv'],
    }
  }
  // 깔지 않는 파일(좁은 쓰임의 requirements)에만 있는 도구는 그 파일을 말한다
  const narrow = reqs.filter((r) => !main.includes(r) || pm !== 'pip')
  const onlyIn = (tool: string) =>
    narrow.find((r) => requirementNames(at(dir, r), scan.texts).includes(tool))
  const missing = (tool: string, what: string, fallback?: string) => {
    const file = onlyIn(tool)
    if (file !== undefined)
      u.suggestions.push(
        `${tool}: ${file}에만 있어 setup이 깔지 않습니다. setup이 까는 묶음(시험 extra나 dev 묶음)에 더하면 ${what} 쓸 수 있습니다`,
      )
    else if (fallback !== undefined) u.suggestions.push(fallback)
  }
  if (has('ruff')) u.fast.push({ id: 'lint', run: `${p}ruff check .` })
  else if (has('flake8')) u.fast.push({ id: 'lint', run: `${p}flake8` })
  else
    missing(
      'ruff',
      '빠른 검사(lint)를',
      'ruff를 dev 의존성에 더하면 빠른 검사(lint)를 쓸 수 있습니다',
    )
  const src = scan.files.some((f) => f.startsWith(at(dir, 'src/')) && f.endsWith('.py'))
  // [tool.mypy]에 files가 있으면 레포가 정한 대상 그대로
  const target = py.mypyFiles ? '' : src ? ' src' : ' .'
  if (has('mypy')) u.fast.push({ id: 'types', run: `${p}mypy${target}` })
  else if (has('pyright')) u.fast.push({ id: 'types', run: `${p}pyright` })
  else missing('mypy', '형 검사(types)를')
  if (has('import-linter')) u.fast.push({ id: 'imports', run: `${p}lint-imports` })
  if (has('pytest')) {
    let run = `${p}pytest --junitxml=${JUNIT}`
    // --cov는 pytest-cov를 깔 때만(없는 플러그인의 플래그는 pytest를 종료 코드 4로 끝낸다)
    if (has('pytest-cov')) {
      run += ' --cov=. --cov-report=xml:.relay-out/coverage.xml'
      u.coverage = { report: '.relay-out/coverage.xml', format: 'cobertura' }
    } else
      missing(
        'pytest-cov',
        '바뀐 줄 커버리지 래칫을',
        'pytest-cov를 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
      )
    u.acceptance = { id: 'test', run, junit: JUNIT }
    u.test = { id: 'test', run: `${p}pytest` }
  } else
    missing(
      'pytest',
      '수용 시험과 시험 수 래칫을',
      'pytest를 dev 의존성에 더하면 수용 시험과 시험 수 래칫을 쓸 수 있습니다',
    )
  if (has('radon')) {
    const count = `awk '/ - [C-F] /{n++} END{print n+0}'`
    u.ratchets.push({
      id: 'complexity',
      kind: 'command',
      run: `${p}radon cc -n C -i .venv . | ${count}`,
      better: 'lower',
    })
  } else
    missing('radon', '복잡도 래칫을', 'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다')
  return u
}
