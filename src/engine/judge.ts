// 계약 줄 판정과 근거 확인 (docs/m1-modules.md engine 5단계). check.ts가 부른다.
// 수용 시험(JUnit)의 head·base 결과, 커밋된 예시 자료, 근거(code·request)를 본다.

import {
  checkCodeGround,
  checkExamplesFile,
  checkRequestQuote,
  examplesFile,
} from '../core/contract.ts'
import { matchAny } from '../core/glob.ts'
import { applyExampleMismatch, confirmFailures, judgeLines } from '../core/lines.ts'
import { DEFAULT_TEST_GLOBS } from '../core/quality.ts'
import type {
  CommandEvidence,
  CommandRun,
  Contract,
  DiffFacts,
  Grounding,
  GroundingCheck,
  LineVerdict,
  QualityConfig,
  TestCase,
} from '../core/types.ts'
import { showFile } from '../adapters/git.ts'
import { message, type Workspace } from './workspace.ts'

/** JUnit을 읽은 실행들의 testcase를 모은다. 하나도 없으면 null */
export function testsOf(runs: CommandRun[]): TestCase[] | null {
  const read = runs.filter((r) => r.tests !== undefined)
  return read.length === 0 ? null : read.flatMap((r) => r.tests ?? [])
}

export async function judgeContract(
  contract: Contract,
  q: QualityConfig | null,
  ws: Workspace,
  root: string,
  diff: DiffFacts,
  acceptance: CommandEvidence | null,
  missing: string[],
): Promise<LineVerdict[]> {
  const spec = q?.commands.acceptance
  if (q === null || spec === undefined || acceptance === null) {
    missing.push('acceptance')
    return judgeLines(contract, null, null)
  }
  // head가 다시 돌았으면 두 번의 결과를 모두 본다(한 번이라도 실패면 실패)
  const head = testsOf(acceptance.head)
  let base: TestCase[] | null = null
  // 바뀜 줄은 base에서 실패를, 지킴 줄은 base에서 통과를 보여야 한다
  const wantsBase = contract.lines.some(
    (l) => l.check === 'test' && (l.kind === 'change' || l.kind === 'keep'),
  )
  const paths = overlayPaths(diff, q)
  if (head !== null && wantsBase) {
    const run = await ws.overlaidBaseRun(spec, paths)
    base = run?.tests ?? null
    if (run !== null && base === null)
      missing.push('acceptance(base에 시험 얹기): JUnit을 읽지 못함')
  }
  let verdicts = judgeLines(contract, head, base)
  // 바뀜 줄의 기준 실패는 met의 근거다. 한 번의 우연한 실패를 증거로 쓰지 않게 한 번 더 돈다(V7)
  if (base !== null && failedOnBase(verdicts)) {
    const again = await ws.overlaidBaseRun(spec, paths)
    if (again?.tests === undefined) missing.push('acceptance(base 다시): JUnit을 읽지 못함')
    else verdicts = judgeLines(contract, head, confirmFailures(base, again.tests))
  }
  return applyExampleMismatch(verdicts, await examplesDiffer(root, diff.head, q, contract, missing))
}

function failedOnBase(verdicts: LineVerdict[]): boolean {
  return verdicts.some((v) => v.kind === 'change' && v.examples.some((e) => e.base === 'failed'))
}

/** head에 커밋된 예시 자료가 승인된 예시와 다른 예시 id */
async function examplesDiffer(
  root: string,
  head: string,
  q: QualityConfig,
  contract: Contract,
  missing: string[],
): Promise<string[]> {
  const path = examplesFile(q.examples_dir, contract.id)
  try {
    const r = checkExamplesFile(contract, await showFile(root, head, path))
    if (r.error !== undefined) missing.push(`예시 자료 ${path}: ${r.error}`)
    return r.differs
  } catch (e) {
    missing.push(`예시 자료 ${path}: ${message(e)}`)
    return []
  }
}

/** base에 얹을 head의 경로: 바뀐 시험 파일(옛 자리 포함)과 예시 자료 폴더 */
function overlayPaths(diff: DiffFacts, q: QualityConfig): string[] {
  const globs = q.test_globs.length > 0 ? q.test_globs : DEFAULT_TEST_GLOBS
  const paths = new Set<string>()
  for (const f of diff.files) {
    for (const p of [f.path, f.old_path]) if (p !== undefined && matchAny(p, globs)) paths.add(p)
  }
  paths.add(q.examples_dir)
  return [...paths]
}

export async function checkGroundings(
  root: string,
  head: string,
  contract: Contract,
  request: string | null,
): Promise<GroundingCheck[]> {
  const files = new Map<string, Promise<string | null>>()
  const fileAt = (path: string): Promise<string | null> => {
    let p = files.get(path)
    if (p === undefined) {
      p = showFile(root, head, path).catch(() => null)
      files.set(path, p)
    }
    return p
  }
  const out: GroundingCheck[] = []
  for (const line of contract.lines) {
    for (const ground of line.grounds) {
      out.push({ line: line.id, ground, ...(await checkGround(ground, fileAt, request)) })
    }
  }
  return out
}

async function checkGround(
  ground: Grounding,
  fileAt: (path: string) => Promise<string | null>,
  request: string | null,
): Promise<{ ok: boolean; detail: string }> {
  switch (ground.type) {
    case 'code':
      return checkCodeGround(await fileAt(ground.path), ground)
    case 'request':
      if (request === null) return { ok: false, detail: '요청 글이 없음' }
      return checkRequestQuote(request, ground.quote)
        ? { ok: true, detail: '요청에 그 구절이 있음' }
        : { ok: false, detail: '요청에 그 구절이 없음' }
    case 'knowledge':
      return { ok: false, detail: '지식 저장소가 없어 확인하지 못함' }
    case 'guess':
      return { ok: false, detail: '추측: 확인할 근거가 없음' }
  }
}
