#!/usr/bin/env node
// 가짜 gh (docs/m2-modules.md 2절). src/adapters/gh.ts가 부르는 명령과, 세션이 PR을 여는 `pr create`만 흉내 낸다.
// 상태는 FAKE_GH_STATE의 JSON 파일이고, 부를 때마다 인자와 cwd를 FAKE_GH_LOG에 한 줄({"args":[…],"cwd":…})씩 남긴다.
// 모양은 v2 녹화본(relay-v2 app/test/contract/fixtures/gh.json)과 GitHub REST 문서를 따른다.
//
// 상태 파일 (모두 선택):
//   {
//     "auth": true,                       // false면 auth status가 실패한다
//     "prs": [{ "number": 1, "url": "…", "state": "OPEN", "headRefName": "relay/x-ab12", "baseRefName": "main",
//               "headRefOid": "<sha>",    // 없으면 cwd의 origin에서 headRefName의 끝 커밋을 읽는다(push를 따라간다)
//               "isDraft": false, "mergedAt": null, "mergeable": "MERGEABLE", "mergeStateStatus": "CLEAN",
//               "statusCheckRollup": [] }],
//     "branches": { "main": { "name": "main", "protected": true,
//                             "protection": { "required_status_checks": { "enforcement_level": "everyone",
//                                                                          "contexts": ["ci"], "strict": true } } } },
//     "rules": { "main": [{ "type": "merge_queue", "parameters": {} }] },
//     "runs": [{ "name": "ci", "path": ".github/workflows/ci.yml", "head_sha": "<sha>", "event": "push",
//                "status": "completed", "conclusion": "failure", "run_attempt": 2 }],   // 녹화본 run 모양의 칸만
//     "fail": ["pr merge"]                // 그 명령이 종료 코드 1로 실패한다:
//                                         // auth, pr list, pr view, pr merge, pr create, api branches, api rules,
//                                         // api runs
//   }
//
// 명령:
//   --version | auth status
//   pr list --head <b> [--state open|closed|merged|all] [--json f1,f2] [--limit n]   최근 것부터
//   pr view <n> --json f1,f2
//   pr merge <n> --merge|--squash|--rebase [--match-head-commit <sha>]   머지하면 state MERGED, mergedAt
//   pr create [--head <b>] [--base <b>] [--title t] [--body b | --body-file f] [--draft]   head는 origin에 있어야 한다
//   api repos/{owner}/{repo}/branches/<b>         branches에 없으면 HTTP 404
//   api repos/{owner}/{repo}/rules/branches/<b>   rules에 없으면 []
//   api repos/{owner}/{repo}/actions/runs?head_sha=<sha>&event=<e>   runs에서 고름. 봉투 workflow_runs는 GitHub REST 문서의 꼴
//                                                 (녹화본에는 run 하나의 모양만 있다)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const env = process.env
const [cmd, sub] = argv

if (env.FAKE_GH_LOG) {
  fs.appendFileSync(env.FAKE_GH_LOG, `${JSON.stringify({ args: argv, cwd: process.cwd() })}\n`)
}

/** --name 값 또는 --name=값. 없으면 undefined */
function opt(name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1]
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1)
  }
  return undefined
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exit(0)
}

/** Windows에서 다른 호출이 같은 파일로 이름을 바꾸는 동안 실패하는 일이 있어 잠깐 기다렸다 다시 한다 */
function retrying(fn) {
  for (let i = 0; ; i++) {
    try {
      return fn()
    } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}

function loadState() {
  const file = env.FAKE_GH_STATE
  const s = file && retrying(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')))
  return { auth: true, prs: [], branches: {}, rules: {}, runs: [], fail: [], ...(s || {}) }
}

/** 시험이 반쯤 쓴 파일을 읽지 않게 임시 파일에 쓰고 이름을 바꾼다 */
function saveState(state) {
  const file = env.FAKE_GH_STATE
  if (!file) fail('가짜 gh: FAKE_GH_STATE가 없어 상태를 남기지 못함')
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  retrying(() => fs.renameSync(tmp, file))
}

const state = loadState()
const failing = (name) => state.fail.includes(name)

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

/** cwd의 origin에 있는 브랜치의 끝 커밋. 없으면 '' */
function remoteHead(branch) {
  try {
    const line = git('ls-remote', 'origin', `refs/heads/${branch}`)
    return line.split(/\s+/)[0] ?? ''
  } catch {
    return ''
  }
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** 상태의 PR에 기본값을 채운다. headRefOid가 없으면 origin에서 읽는다 */
function prFields(pr) {
  const mergeable = pr.mergeable ?? 'MERGEABLE'
  return {
    title: 'fake PR',
    isDraft: false,
    mergedAt: null,
    statusCheckRollup: [],
    mergeStateStatus:
      mergeable === 'CONFLICTING' ? 'DIRTY' : mergeable === 'UNKNOWN' ? 'UNKNOWN' : 'CLEAN',
    ...pr,
    mergeable,
    state: pr.state ?? 'OPEN',
    headRefOid: pr.headRefOid || remoteHead(pr.headRefName),
  }
}

function pick(obj, fields) {
  return Object.fromEntries(fields.map((f) => [f, obj[f] ?? null]))
}

function findPr(number) {
  const pr = state.prs.find((p) => p.number === number)
  if (!pr) {
    fail(
      `GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)`,
    )
  }
  return pr
}

if (cmd === '--version') {
  process.stdout.write(
    'gh version 2.101.0 (2026-09-15)\nhttps://github.com/cli/cli/releases/tag/v2.101.0\n',
  )
  process.exit(0)
}

if (cmd === 'auth' && sub === 'status') {
  if (state.auth === false || failing('auth')) fail('You are not logged into any GitHub hosts.')
  process.stdout.write('github.com\n  ✓ Logged in to github.com account fake (keyring)\n')
  process.exit(0)
}

if (cmd === 'pr' && sub === 'list') {
  if (failing('pr list')) fail('HTTP 502: Bad Gateway (https://api.github.com/graphql)')
  const head = opt('--head')
  const want = (opt('--state') ?? 'open').toUpperCase()
  const fields = (opt('--json') ?? 'number,title,headRefName,state').split(',')
  const limit = Number(opt('--limit') ?? 30)
  const rows = state.prs
    .map(prFields)
    .filter((p) => head === undefined || p.headRefName === head)
    .filter((p) => want === 'ALL' || p.state === want)
    .sort((a, b) => b.number - a.number)
    .slice(0, limit)
  print(rows.map((p) => pick(p, fields)))
}

if (cmd === 'pr' && sub === 'view') {
  if (failing('pr view')) fail('GraphQL: API rate limit exceeded for user ID 1.')
  const fields = opt('--json')
  if (!fields) fail('가짜 gh: pr view는 --json만 흉내 낸다')
  print(pick(prFields(findPr(Number(argv[2]))), fields.split(',')))
}

if (cmd === 'pr' && sub === 'merge') {
  const number = Number(argv[2])
  const pr = findPr(number)
  const cur = prFields(pr)
  const method = ['merge', 'squash', 'rebase'].find((m) => argv.includes(`--${m}`))
  // 이미 머지된 PR은 gh가 아무것도 하지 않고 성공한다
  if (cur.state === 'MERGED') process.exit(0)
  if (cur.state === 'CLOSED') fail(`X Pull request #${number} is closed`)
  if (!method) fail('--merge, --rebase, or --squash required when not running interactively')
  if (cur.mergeStateStatus === 'BLOCKED') {
    fail(`X Pull request #${number} is not mergeable: the base branch policy prohibits the merge.`)
  }
  if (cur.mergeable === 'CONFLICTING') {
    fail(`X Pull request #${number} is not mergeable: the merge commit cannot be cleanly created.`)
  }
  if (failing('pr merge')) fail('GraphQL: Pull Request is not mergeable (mergePullRequest)')
  const expected = opt('--match-head-commit')
  if (expected && expected !== cur.headRefOid) {
    fail('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)')
  }
  pr.state = 'MERGED'
  pr.mergedAt = now()
  pr.headRefOid = cur.headRefOid
  pr.mergeMethod = method
  saveState(state)
  // TTY가 아니면 성공해도 아무것도 찍지 않는다 (v2 S7 관찰 6)
  process.exit(0)
}

if (cmd === 'pr' && sub === 'create') {
  if (failing('pr create')) fail('pull request create failed: HTTP 422 (가짜 gh)')
  let current = ''
  try {
    current = git('rev-parse', '--abbrev-ref', 'HEAD')
  } catch {
    // 레포가 아니다
  }
  const head = opt('--head') ?? current
  const base = opt('--base') ?? 'main'
  const oid = remoteHead(head)
  if (!head || !oid) {
    fail(
      `pull request create failed: GraphQL: Head sha can't be blank, Head ref must be a branch (createPullRequest)`,
    )
  }
  const open = state.prs.map(prFields).find((p) => p.headRefName === head && p.state === 'OPEN')
  if (open)
    fail(`a pull request for branch "${head}" into branch "${base}" already exists:\n${open.url}`)
  const number = Math.max(0, ...state.prs.map((p) => p.number)) + 1
  const bodyFile = opt('--body-file')
  const pr = {
    number,
    url: `https://github.test/fake/repo/pull/${number}`,
    title: opt('--title') ?? head,
    body: bodyFile ? fs.readFileSync(bodyFile, 'utf8') : (opt('--body') ?? ''),
    state: 'OPEN',
    headRefName: head,
    baseRefName: base,
    isDraft: argv.includes('--draft'),
    mergedAt: null,
  }
  state.prs.push(pr)
  saveState(state)
  process.stdout.write(`${pr.url}\n`)
  process.exit(0)
}

if (cmd === 'api') {
  const target = argv.slice(1).find((a) => !a.startsWith('-')) ?? ''
  const runs = /^repos\/[^/]+\/[^/]+\/actions\/runs\?(.*)$/.exec(target)
  if (runs) {
    if (failing('api runs')) fail('gh: Server Error (HTTP 502)')
    const q = new URLSearchParams(runs[1])
    const rows = state.runs.filter(
      (r) =>
        (!q.get('head_sha') || r.head_sha === q.get('head_sha')) &&
        (!q.get('event') || r.event === q.get('event')),
    )
    print({ workflow_runs: rows })
  }
  const m = /^repos\/[^/]+\/[^/]+\/(rules\/)?branches\/(.+)$/.exec(target)
  if (!m) fail(`가짜 gh: 모르는 api 요청 ${argv.join(' ')}`)
  const branch = decodeURIComponent(m[2])
  if (m[1]) {
    if (failing('api rules')) fail('gh: Not Found (HTTP 404)')
    print(state.rules[branch] ?? [])
  }
  if (failing('api branches')) fail('gh: Not Found (HTTP 404)')
  const found = state.branches[branch]
  if (!found) {
    process.stdout.write(`${JSON.stringify({ message: 'Branch not found', status: '404' })}\n`)
    fail('gh: Branch not found (HTTP 404)')
  }
  print({ name: branch, protected: false, ...found })
}

fail(`가짜 gh: 모르는 명령 ${argv.join(' ')}`)
