// 계약 줄 판정과 근거 확인 (docs/m1-modules.md engine 5단계). check.ts가 부른다.
// 수용 시험(JUnit)의 head·base 결과, 예시 자료(V27: 앱이 계약에서 쓴 정규 파일을 얹고, 커밋된 파일은 승인본과 견준다),
// 근거(code·request)를 본다.

import {
  checkCodeGround,
  checkExamplesFile,
  checkRequestQuote,
  examplesFile,
  examplesFileText,
} from '../core/contract.ts'
import { matchAny } from '../core/glob.ts'
import { confirmFailures, judgeLines } from '../core/lines.ts'
import { DEFAULT_TEST_GLOBS } from '../core/quality.ts'
import type {
  CommandEvidence,
  CommandRun,
  Contract,
  DiffFacts,
  ExamplesFileCheck,
  Grounding,
  GroundingCheck,
  LineVerdict,
  QualityConfig,
  TestCase,
} from '../core/types.ts'
import { showFile } from '../adapters/git.ts'
import { UNRECORDED_TITLE } from './debt-record.ts'
import { checkKnowledgeGround } from './knowledge.ts'
import { LIST_HEADING } from './knowledge-format.ts'
import { TIDY_TITLE } from './tidy.ts'
import { message, type OverlayFile, type Workspace } from './workspace.ts'

/** JUnit을 읽은 실행들의 testcase를 모은다. 하나도 없으면 null */
export function testsOf(runs: CommandRun[]): TestCase[] | null {
  const read = runs.filter((r) => r.tests !== undefined)
  return read.length === 0 ? null : read.flatMap((r) => r.tests ?? [])
}

/**
 * 수용 시험에 얹을 예시 자료의 정규 파일(V27): examples_dir/<계약 id>.json에 계약의 예시. 계약에 예시가 없으면 null
 */
export function canonicalExamples(q: QualityConfig, contract: Contract): OverlayFile | null {
  if (contract.examples.length === 0) return null
  return { path: examplesFile(q.examples_dir, contract.id), text: examplesFileText(contract) }
}

/**
 * 줄 판정. head의 수용 시험은 check가 examples를 얹어 이미 돌렸다(acceptance). 바뀜·지킴 줄의 base 실행에도 시험 파일과
 * 함께 examples를 얹는다: 줄 판정은 승인된 자료로 돈다
 */
export async function judgeContract(
  contract: Contract,
  q: QualityConfig | null,
  ws: Workspace,
  diff: DiffFacts,
  acceptance: CommandEvidence | null,
  examples: OverlayFile | null,
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
  const files = examples === null ? [] : [examples]
  if (head !== null && wantsBase) {
    const run = await ws.overlaidBaseRun(spec, paths, files)
    base = run?.tests ?? null
    if (run !== null && base === null)
      missing.push('acceptance(base에 시험 얹기): JUnit을 읽지 못함')
  }
  let verdicts = judgeLines(contract, head, base)
  // 바뀜 줄의 기준 실패는 met의 근거다. 한 번의 우연한 실패를 증거로 쓰지 않게 한 번 더 돈다(V7)
  if (base !== null && failedOnBase(verdicts)) {
    const again = await ws.overlaidBaseRun(spec, paths, files)
    if (again?.tests === undefined) missing.push('acceptance(base 다시): JUnit을 읽지 못함')
    else verdicts = judgeLines(contract, head, confirmFailures(base, again.tests))
  }
  return verdicts
}

function failedOnBase(verdicts: LineVerdict[]): boolean {
  return verdicts.some((v) => v.kind === 'change' && v.examples.some((e) => e.base === 'failed'))
}

/**
 * head에 커밋된 예시 자료를 승인본과 값으로 견준다(V27). 다르거나 없으면 관문이 사람에게 보낸다: 줄 판정은 얹은 승인본으로
 * 돌았지만 머지 뒤의 회귀 시험은 커밋된 파일을 읽는다. 계약에 예시가 없으면 null. git이 실패하면 missing에 적고 null
 */
export async function committedExamples(
  root: string,
  head: string,
  q: QualityConfig,
  contract: Contract,
  missing: string[],
): Promise<ExamplesFileCheck | null> {
  if (contract.examples.length === 0) return null
  const path = examplesFile(q.examples_dir, contract.id)
  try {
    return { path, ...checkExamplesFile(contract, await showFile(root, head, path)) }
  } catch (e) {
    missing.push(`예시 자료 ${path}: ${message(e)}`)
    return null
  }
}

/** base에 얹을 head의 경로: 바뀐 시험 파일(옛 자리 포함)과 예시 자료 폴더(그 위에 정규 파일을 쓴다) */
function overlayPaths(diff: DiffFacts, q: QualityConfig): string[] {
  const globs = q.test_globs.length > 0 ? q.test_globs : DEFAULT_TEST_GLOBS
  const paths = new Set<string>()
  for (const f of diff.files) {
    for (const p of [f.path, f.old_path]) if (p !== undefined && matchAny(p, globs)) paths.add(p)
  }
  paths.add(q.examples_dir)
  return [...paths]
}

/** relay가 request.md 끝에 붙이는 절(M3: 관련 지식, 기록 안 된 나빠짐, 이 레포의 빚)의 제목 */
const RELAY_SECTIONS = [LIST_HEADING, UNRECORDED_TITLE, TIDY_TITLE]

/** 요청 글에서 사람이 쓴 것: relay가 붙인 첫 절 앞까지. 근거 request의 인용은 이것으로 확인한다 */
export function humanRequest(text: string): string {
  const at = RELAY_SECTIONS.map((h) => text.indexOf(`\n${h}\n`)).filter((i) => i >= 0)
  return at.length === 0 ? text : text.slice(0, Math.min(...at) + 1)
}

/**
 * 계약 줄의 근거 확인. knowledge가 참이면(지식 잇기, V38) 근거 knowledge의 항목이 head에 있는지 본다. 근거 request는 사람이 쓴
 * 요청(humanRequest)에서 찾는다: relay가 고른 지식 목록이나 알림을 인용하면 사람이 말한 것이 아니다
 */
export async function checkGroundings(
  root: string,
  head: string,
  contract: Contract,
  request: string | null,
  knowledge = false,
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
  const asked = request === null ? null : humanRequest(request)
  const out: GroundingCheck[] = []
  for (const line of contract.lines) {
    for (const ground of line.grounds) {
      out.push({
        line: line.id,
        ground,
        ...(await checkGround(ground, fileAt, asked, knowledge)),
      })
    }
  }
  return out
}

async function checkGround(
  ground: Grounding,
  fileAt: (path: string) => Promise<string | null>,
  request: string | null,
  knowledge: boolean,
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
      if (knowledge) return checkKnowledgeGround(ground.id, fileAt)
      return { ok: false, detail: '지식 잇기가 꺼져 있어 확인하지 못함' }
    case 'guess':
      return { ok: false, detail: '추측: 확인할 근거가 없음' }
  }
}
