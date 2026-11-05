// 제출 때 기준 확인 (V28, docs/m1-modules.md engine/probe.ts, docs/m2.1-design.md 9절). main의 submit_contract와
// request_contract_change가 부른다. head의 바뀐 시험 파일 가운데 이 계약의 태그가 든 것이 있으면, 증거의 바뀜·지킴 줄 판정과
// 같은 길(judge.ts의 얹기 경로와 Workspace.overlaidBaseRun)로 바뀐 시험 파일과 제출된 계약의 정규 예시 자료를 기준에 얹고
// 수용 명령을 한 번 돈다(시간 제한은 그 명령의 것). 줄은 core probeVerdicts가 증거와 같은 규칙으로 본다.
// 확인은 줄을 충족으로 만들지 않는다: 증거를 잴 때 head에서 다시 판정한다.

import { contractHash, exampleTag } from '../core/contract.ts'
import { probeVerdicts } from '../core/lines.ts'
import type { CommandRun, Contract, ContractProbe, LineVerdict, TestCase } from '../core/types.ts'
import { showFile } from '../adapters/git.ts'
import { repoKey } from '../adapters/store.ts'
import { lockWorktrees } from '../adapters/worktrees.ts'
import { DEFAULT_LOCK_WAIT_MS, loadQuality, readDiff, resolveRefs } from './check.ts'
import { canonicalExamples, overlayPaths } from './judge.ts'
import { DEFAULT_COMMAND_TIMEOUT_SEC, message, workspace } from './workspace.ts'

export interface ProbeOptions {
  /** 레포 안의 아무 폴더(Work의 worktree) */
  repo: string
  /** 확인할 head(Work 브랜치의 끝) */
  head: string
  /** 기준 ref. head와의 공통 조상을 기준으로 쓴다 */
  base: string
  /** 제출된 계약(승인 표시를 뗀 것) */
  contract: Contract
  home: string
  /** 다른 check가 이 레포의 worktree를 쓰고 있을 때 기다리는 시간(밀리초). 기본은 check와 같다 */
  lockWaitMs?: number
}

/**
 * 태그의 끝(`:C1.1]`). 계약 id가 든 시험 파일에서만 찾으므로, id를 상수로 쓴 꼴(`[${ID}:C1.1]`)도 잡는다. M2 평가의
 * relay3 쪽 끝 diff 가운데 태그를 쓴 152개 중 24개는 이 꼴의 태그만 썼다
 */
const TAG_TAIL = /:(C\d+\.\d+)\]/g

/** 레포나 ref를 찾지 못하면 던진다(CheckInputError). 그 밖의 실패는 ran false와 note로 돌려준다 */
export async function probeContract(o: ProbeOptions): Promise<ContractProbe> {
  const started = Date.now()
  const { root, base, head } = await resolveRefs(o)
  const done = (note: string | null, lines: LineVerdict[] | null = null): ContractProbe => ({
    head,
    base,
    contract: contractHash(o.contract),
    ran: lines !== null,
    note,
    lines: lines ?? [],
    ms: Date.now() - started,
  })
  const missing: string[] = []
  const q = (await loadQuality(root, base, head, missing)).config
  const spec = q?.commands.acceptance
  if (q === null || spec === undefined) return done('품질 기준에 수용 시험 명령이 없음')
  const paths = overlayPaths(await readDiff(root, base, head, missing), q)
  const tagged = await taggedTests(root, head, paths, o.contract.id)
  const wanted = new Set(
    o.contract.lines
      .filter((l) => l.check === 'test' && (l.kind === 'change' || l.kind === 'keep'))
      .flatMap((l) => l.examples.map((id) => exampleTag(o.contract.id, id))),
  )
  if (!tagged.some((t) => wanted.has(t.name)))
    return done('바뀜·지킴 줄의 예시 태그를 단 시험 파일이 head에 없음')

  const key = repoKey(root)
  let release: () => Promise<void>
  try {
    release = await lockWorktrees(o.home, key, o.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS)
  } catch (e) {
    return done(`worktree: ${message(e)}`)
  }
  // 이 실행의 까닭만 note에 적는다(품질 기준·diff의 없는 증거는 확인과 상관없다)
  const from = missing.length
  let run: CommandRun | null
  try {
    const setup = q.setup === undefined ? {} : { setup: q.setup }
    const ws = workspace({ home: o.home, key, root, base, head, ...setup, rerun: false, missing })
    const examples = canonicalExamples(q, o.contract)
    run = await ws.overlaidBaseRun(spec, paths, examples === null ? [] : [examples])
  } catch (e) {
    missing.push(message(e))
    run = null
  } finally {
    await release().catch(() => {})
  }
  if (run === null)
    return done(`기준에서 돌리지 못함: ${missing.slice(from).join('; ') || '까닭 모름'}`)
  if (run.timed_out)
    return done(`시간 제한 ${spec.timeout_sec ?? DEFAULT_COMMAND_TIMEOUT_SEC}초를 넘음`)
  if (run.tests === undefined) return done(`JUnit을 읽지 못함 (${spec.junit ?? '경로 없음'})`)
  return done(null, probeVerdicts(o.contract, run.tests, tagged))
}

/**
 * head의 얹을 경로 가운데 계약 id가 든 시험 파일에서 예시 태그를 찾는다. 태그 하나에 TestCase 하나(돌리지 않았다: file만
 * 본다). 지운 파일과 폴더(예시 자료 폴더)는 읽히지 않아 건너뛴다
 */
async function taggedTests(
  root: string,
  head: string,
  paths: string[],
  contractId: string,
): Promise<TestCase[]> {
  const out: TestCase[] = []
  for (const path of paths) {
    const text = await showFile(root, head, path).catch(() => null)
    if (text === null || !text.includes(contractId)) continue
    const ids = new Set(Array.from(text.matchAll(TAG_TAIL), (m) => m[1] ?? ''))
    for (const id of ids)
      out.push({ name: exampleTag(contractId, id), file: path, status: 'passed' })
  }
  return out
}
