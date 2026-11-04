// 세션의 git·gh 바닥 막기 (docs/m2-app.md 3절, docs/m2-modules.md 1절). v2 app/src/core/git-guard.ts(v2 D558)를 옮겼다.
// 세션은 작업 브랜치에 push하고 PR을 열 수 있다. 되돌리기 어려운 것만 막는다: 지킬 브랜치(기준, main, master)에 push,
// 강제 push, 원격 브랜치 지우기, 모든 브랜치 push, PR 머지(gh pr merge, gh api의 머지·GraphQL 머지), gh api로 지킬 브랜치의
// ref를 바꾸거나 그 브랜치에 바로 커밋하기.
// 명령 줄의 낱말만 본다(따옴표, 서브셸, 명령 치환, sh -c는 벗겨 본다). 스크립트나 별칭 안의 명령, 변수로 만든 이름은
// 막지 못한다(실수를 막는 장치다).

/** git과 gh의 전역 옵션 가운데 값을 다음 낱말로 받는 것 */
const VALUE_OPTIONS: Readonly<Record<'git' | 'gh', readonly string[]>> = {
  git: ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'],
  gh: ['-R', '--repo', '--hostname'],
}

/** git push의 옵션 가운데 값을 다음 낱말로 받는 것 */
const PUSH_VALUE_OPTIONS = ['-o', '--push-option', '--repo', '--receive-pack', '--exec']

/** 막는 git push 옵션 */
const PUSH_BLOCKED = new Set([
  '-f',
  '--force',
  '--force-with-lease',
  '--force-if-includes',
  '-d',
  '--delete',
  '--mirror',
  '--all',
  '--prune',
])

/** 언제나 지키는 브랜치 이름 */
export const ALWAYS_PROTECTED = ['main', 'master'] as const

const MERGE = 'PR 머지는 사람이 합니다. relay가 막았습니다'
const DELETE_REMOTE = '원격 브랜치 지우기는 relay가 막습니다'

const branchName = (ref: string) => ref.replace(/^refs\/heads\//, '')

/** 인자의 따옴표를 모두 떼고(셸이 이어 붙인다: HEAD:"main") 끝의 닫는 괄호를 뗀다 */
const unquote = (w: string) => w.replace(/['"]/g, '').replace(/[)`]+$/, '')

/** 명령 이름 앞의 서브셸·명령 치환 글자를 뗀다: (git, $(git, `git. 따옴표 안의 글(echo "git push")은 명령이 아니다 */
const cmdName = (w: string) => w.replace(/^[($`]+/, '')

/** gh api에서 머지·기준 ref 바꾸기에 쓰이는 GraphQL 변경 */
const GRAPHQL_RISK =
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|mergeBranch|updateRefs?|deleteRef)\b/

/** gh api의 필드 옵션. 하나라도 있으면 기본 메서드가 POST다 (gh help api) */
const API_FIELD = /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)/

/** gh api로 PR을 머지하거나, 기준 브랜치에 바로 머지·쓰거나, ref를 강제로 바꾸거나 지우는가 */
function ghApiRisk(words: readonly string[], guarded: ReadonlySet<string>): string | null {
  let method: string | null = null
  let hasField = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''
    if (w === '-X' || w === '--method') method = (words[i + 1] ?? '').toUpperCase()
    else if (w.startsWith('--method=')) method = w.slice(9).toUpperCase()
    else if (/^-X[A-Za-z]+$/.test(w)) method = w.slice(2).toUpperCase()
    else if (API_FIELD.test(w)) hasField = true
  }
  method ??= hasField ? 'POST' : 'GET'
  const endpoint = words.find((w) => !w.startsWith('-') && /^\/?(?:repos\/|graphql$)/.test(w)) ?? ''
  const field = (name: string) =>
    words.find((w) => w.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
  if (endpoint.replace(/^\//, '') === 'graphql')
    return GRAPHQL_RISK.test(words.join(' ')) ? MERGE : null
  if (method === 'GET') return null
  if (method === 'PUT' && /\/pulls\/\d+\/merge\b/.test(endpoint)) return MERGE
  if (method === 'POST' && /\/merges\/?$/.test(endpoint)) return MERGE
  const ref = /\/git\/refs\/(.+)$/.exec(endpoint)?.[1]
  if (ref !== undefined) {
    if (method === 'DELETE') return DELETE_REMOTE
    const branch = branchName(ref.replace(/^heads\//, 'refs/heads/'))
    if (guarded.has(branch))
      return `${branch}를 gh api로 바꾸지 않습니다. 작업 브랜치에 push하고 PR을 여세요 (relay가 막음)`
    if (field('force') === 'true') return `강제로 ref 바꾸기(${endpoint})는 relay가 막습니다`
  }
  // 파일 내용 API는 브랜치에 바로 커밋한다. branch가 없으면 기본 브랜치다
  if ((method === 'PUT' || method === 'DELETE') && /\/contents\//.test(endpoint)) {
    const branch = field('branch')
    if (branch === null || guarded.has(branchName(branch)))
      return `${branch ?? '기본 브랜치'}에 gh api로 바로 커밋하지 않습니다 (relay가 막음)`
  }
  return null
}

/** 값을 다음 낱말로 받는 옵션을 건너뛰고 첫 낱말이 아닌 자리 */
function skipOptions(words: readonly string[], from: number, valueOptions: readonly string[]) {
  let n = from
  while (n < words.length && (words[n] ?? '').startsWith('-'))
    n += valueOptions.includes(words[n] ?? '') ? 2 : 1
  return n
}

/** 막을 동작이 있으면 까닭, 없으면 null */
function findRisk(command: string, protectedBranches: readonly string[]): string | null {
  // sh -c '…', bash -c "…" 안의 명령도 본다
  for (const m of command.matchAll(/\b(?:ba|z)?sh\s+-c\s+(['"])([\s\S]*?)\1/g)) {
    const inner = findRisk(m[2] ?? '', protectedBranches)
    if (inner) return inner
  }
  const guarded = new Set([...ALWAYS_PROTECTED, ...protectedBranches.map(branchName)])
  for (const part of command.split(/[\n;&|]+|\$\(|`/)) {
    const words = part.trim().split(/\s+/).filter(Boolean)
    for (let k = 0; k < words.length; k++) {
      const name = cmdName(words[k] ?? '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.exe$/i, '')
        .toLowerCase()
      if (name !== 'git' && name !== 'gh') continue
      const n = skipOptions(words, k + 1, VALUE_OPTIONS[name])
      const sub = unquote(words[n] ?? '').toLowerCase()
      // gh pr -R o/r merge: -R/--repo는 pr 뒤에도 온다
      const prSub = unquote(words[skipOptions(words, n + 1, VALUE_OPTIONS.gh)] ?? '')
      if (name === 'gh' && sub === 'pr' && prSub.toLowerCase() === 'merge') return MERGE
      if (name === 'gh' && sub === 'api') {
        const r = ghApiRisk(words.slice(n + 1).map(unquote), guarded)
        if (r) return r
      }
      if (name !== 'git' || sub !== 'push') continue
      const args: string[] = []
      for (let i = n + 1; i < words.length; i++) {
        const w = unquote(words[i] ?? '')
        if (w.startsWith('-')) {
          const opt = w.split('=')[0] ?? w
          if (PUSH_BLOCKED.has(opt) || (/^-[a-z]*[fd]/i.test(w) && !w.startsWith('--')))
            return `강제 push, 원격 브랜치 지우기, 모든 브랜치 push는 relay가 막습니다 (${w})`
          if (PUSH_VALUE_OPTIONS.includes(w)) i++
          continue
        }
        args.push(w)
      }
      // 첫 낱말은 원격이고 나머지는 refspec이다
      for (const spec of args.slice(1)) {
        if (spec.startsWith('+')) return `강제 push(${spec})는 relay가 막습니다`
        if (spec.startsWith(':')) return `원격 브랜치 지우기(${spec})는 relay가 막습니다`
        const dest = branchName(spec.includes(':') ? (spec.split(':')[1] ?? '') : spec)
        if (/[*?[]/.test(dest)) return `여러 브랜치를 한꺼번에 push(${spec})는 relay가 막습니다`
        if (guarded.has(dest))
          return `${dest}에 바로 push하지 않습니다. 작업 브랜치에 push하고 PR을 여세요 (relay가 막음)`
      }
    }
  }
  return null
}

/**
 * Bash 명령 줄에서 막을 git·gh 동작을 찾는다. protectedBranches는 이 Work의 기준 브랜치다(main, master는 늘 더한다).
 * 막으면 reason에 까닭(세션이 읽는다), 아니면 blocked false와 빈 reason
 */
export function guardCommand(
  command: string,
  protectedBranches: string[],
): { blocked: boolean; reason: string } {
  const reason = findRisk(command, protectedBranches)
  return reason ? { blocked: true, reason } : { blocked: false, reason: '' }
}
