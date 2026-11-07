// 래칫 재기 (docs/m1-modules.md engine/check.ts 6단계). check.ts에서 옮겼다(파일 상한).
// file_lines·test_count·command는 core ratchet.ts로, 앱이 직접 재는 셋(V55~V57)은 suppressions·duplication·coverage로 견준다.
// 억누름과 중복은 git만 읽고(worktree 없음), 바뀐 줄 커버리지는 수용 시험이 head worktree에 쓴 보고서를 읽는다.

import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { err, type Result } from '../core/result.ts'
import {
  commandRatchet,
  fileLinesRatchet,
  testCountRatchet,
  type FileLines,
} from '../core/ratchet.ts'
import type {
  CommandEvidence,
  CommandRun,
  DiffFacts,
  QualityConfig,
  RatchetResult,
} from '../core/types.ts'
import { grepLines, lineCounts, lsTree, readBlobs } from '../adapters/git.ts'
import {
  diffCoverageRatchet,
  parseCoverage,
  type DiffCoverageSpec,
  type FileCoverage,
} from './coverage.ts'
import { duplication, duplicationRatchet, MAX_FILE_BYTES, scoped } from './duplication.ts'
import { langOf, SCAN_EXCLUDE } from './languages.ts'
import { matchAny } from '../core/glob.ts'
import { testsOf } from './judge.ts'
import {
  GREP_NEEDLES,
  suppressionsInLine,
  suppressionsRatchet,
  type Suppression,
} from './suppressions.ts'
import { message, type Workspace } from './workspace.ts'

/** 커버리지 보고서의 상한(바이트) */
export const MAX_REPORT_BYTES = 64 * 1024 * 1024

export interface RatchetInputs {
  q: QualityConfig
  ws: Workspace
  root: string
  diff: DiffFacts
  acceptance: CommandEvidence | null
  /** 수용 시험의 head 실행을 시작한 때(ms). 보고서가 그 뒤에 쓰였는지 본다 */
  acceptanceStarted: number | null
  missing: string[]
}

export async function measureRatchets(i: RatchetInputs): Promise<RatchetResult[]> {
  const { q, ws, root, diff, acceptance, missing } = i
  const out: RatchetResult[] = []
  let files: FileLines[] | null | undefined
  // 같은 커밋을 래칫마다 다시 읽지 않는다
  const memo = new Map<string, Promise<unknown>>()
  const once = <T>(key: string, f: () => Promise<T>): Promise<T> => {
    let p = memo.get(key) as Promise<T> | undefined
    if (p === undefined) {
      p = f()
      memo.set(key, p)
    }
    return p
  }
  for (const spec of q.ratchets) {
    if (spec.kind === 'file_lines') {
      if (files === undefined) files = await changedFileLines(root, diff, missing)
      out.push(
        files === null
          ? { id: spec.id, status: 'unknown', detail: '줄 수를 읽지 못함' }
          : fileLinesRatchet(spec, files),
      )
    } else if (spec.kind === 'test_count') {
      // base는 시험을 얹지 않은 base에서 돈 수용 시험
      const head = acceptance === null ? null : testsOf(acceptance.head.slice(0, 1))
      const base = acceptance?.base?.tests ?? null
      out.push(testCountRatchet(spec, base, head))
    } else if (spec.kind === 'command') {
      const head = await ws.headRun(spec)
      const base = await ws.baseRun(spec, `ratchet.${spec.id}`)
      out.push(commandRatchet(spec, stdoutOf(base), stdoutOf(head)))
    } else if (spec.kind === 'suppressions') {
      const read = (sha: string) => once(`s:${sha}`, () => suppressionsAt(root, sha))
      out.push(
        await Promise.all([read(diff.base), read(diff.head)]).then(
          ([b, h]) => suppressionsRatchet(spec, b, h, diff),
          (e) => unknown(spec.id, `억누름을 세지 못함: ${message(e)}`),
        ),
      )
    } else if (spec.kind === 'duplication') {
      const read = (sha: string) => once(`d:${sha}`, () => sourcesAt(root, sha))
      out.push(
        await Promise.all([read(diff.base), read(diff.head)]).then(
          ([b, h]) =>
            duplicationRatchet(
              spec,
              duplication(scoped(b, spec, q.test_globs)),
              duplication(scoped(h, spec, q.test_globs)),
              diff,
            ),
          (e) => unknown(spec.id, `중복을 재지 못함: ${message(e)}`),
        ),
      )
    } else {
      const report = await coverageReport(spec, ws, acceptance, i.acceptanceStarted)
      out.push(diffCoverageRatchet(spec, report, diff, q.test_globs))
    }
  }
  return out
}

const unknown = (id: string, detail: string): RatchetResult => ({ id, status: 'unknown', detail })

/** sha의 모든 억누름 표식 */
async function suppressionsAt(root: string, sha: string): Promise<Suppression[]> {
  const hits = await grepLines(root, sha, GREP_NEEDLES)
  return hits.flatMap((h) => suppressionsInLine(h.path, h.line, h.text))
}

/** sha의 소스 파일 글(표에 있는 언어, 늘 빼는 곳 밖, MAX_FILE_BYTES 이하, 바이너리 아님) */
async function sourcesAt(root: string, sha: string): Promise<Map<string, string>> {
  const paths = (await lsTree(root, sha)).filter(
    (p) => langOf(p) !== null && !matchAny(p, [...SCAN_EXCLUDE]),
  )
  return readBlobs(root, sha, paths, MAX_FILE_BYTES)
}

/**
 * 수용 시험이 head worktree에 쓴 보고서. 수용 시험이 돌지 않았거나, 파일이 없거나, 이번 실행 앞에 쓰인 것(지난 실행의 남은
 * 것, 커밋된 파일)이거나, 읽지 못하면 까닭을 오류로
 */
async function coverageReport(
  spec: DiffCoverageSpec,
  ws: Workspace,
  acceptance: CommandEvidence | null,
  started: number | null,
): Promise<Result<FileCoverage[]>> {
  if (acceptance === null || acceptance.head.length === 0 || started === null)
    return err('수용 시험이 돌지 않음')
  const dir = await ws.dir('head')
  if (dir === null) return err('head worktree가 없음')
  try {
    const real = await realpath(dir)
    const full = resolve(dir, spec.report)
    const at = await realpath(full).catch(() => null)
    if (at === null) return err(`보고서가 없음 (${spec.report})`)
    if (!inside(real, at)) return err(`보고서가 worktree 밖을 가리킴 (${spec.report})`)
    const st = await stat(at)
    if (!st.isFile()) return err(`보고서가 파일이 아님 (${spec.report})`)
    // 파일 시각의 거칠기(몇 초까지)를 넉넉히 둔다
    if (st.mtimeMs < started - 2000)
      return err(`보고서가 이번 수용 시험 실행 앞에 쓰임 (${spec.report})`)
    if (st.size > MAX_REPORT_BYTES) return err(`보고서가 너무 큼 (${spec.report})`)
    return parseCoverage(await readFile(at, 'utf8'), spec.format, [dir, real])
  } catch (e) {
    return err(`보고서를 읽지 못함: ${message(e)}`)
  }
}

function inside(root: string, path: string): boolean {
  const back = relative(root, path)
  return back !== '' && !(back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back))
}

/** 끝까지 돌아 0으로 끝난 실행의 표준 출력만 지표로 읽는다 */
function stdoutOf(r: CommandRun | null): string | null {
  return r !== null && r.exit === 0 && !r.timed_out ? r.stdout_tail : null
}

/** 바뀐 파일마다 base·head 줄 수. 바이너리는 뺀다. git이 실패하면 null */
async function changedFileLines(
  root: string,
  diff: DiffFacts,
  missing: string[],
): Promise<FileLines[] | null> {
  // 새로 생긴 자리(A, C)는 base가 없다. 옮긴 파일(R)은 옛 자리와 견준다
  const basePath = (f: DiffFacts['files'][number]): string | null =>
    f.status === 'A' || f.status === 'C' ? null : f.status === 'R' ? (f.old_path ?? null) : f.path
  const files = diff.files.filter((f) => !f.binary)
  try {
    const [b, h] = await Promise.all([
      lineCounts(
        root,
        diff.base,
        files.flatMap((f) => basePath(f) ?? []),
      ),
      lineCounts(
        root,
        diff.head,
        files.filter((f) => f.status !== 'D').map((f) => f.path),
      ),
    ])
    const out: FileLines[] = []
    for (const f of files) {
      const bp = basePath(f)
      if ((bp !== null && !b.has(bp)) || (f.status !== 'D' && !h.has(f.path))) continue
      // 남아 있는데 줄 수를 못 읽은 파일(예: 서브모듈로 바뀜)은 지운 것이 아니라 셀 수 없음이다
      out.push({
        path: f.path,
        base: bp === null ? null : (b.get(bp) ?? Number.NaN),
        head: f.status === 'D' ? null : (h.get(f.path) ?? Number.NaN),
      })
    }
    return out
  } catch (e) {
    missing.push(`줄 수: ${message(e)}`)
    return null
  }
}
