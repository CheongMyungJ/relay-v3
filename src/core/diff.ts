// git diff 출력을 DiffFacts로 읽는다 (docs/m1-modules.md diff.ts).
// 순수 함수다. git은 adapters가 부르고 여기서는 글만 받는다.

import type { ChangeStatus, DiffFacts, FileChange } from './types.ts'

export interface NameStatusEntry {
  status: ChangeStatus
  path: string
  old_path?: string
}

export interface NumstatEntry {
  path: string
  added: number
  deleted: number
  binary: boolean
}

export interface PatchLines {
  added: string[]
  removed: string[]
  /** 더한 줄의 head 줄 번호 */
  added_at: number[]
}

const STATUSES: readonly string[] = ['A', 'M', 'D', 'R', 'C', 'T']

function splitNul(out: string): string[] {
  const parts = out.split('\0')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

function toStatus(token: string): ChangeStatus {
  const letter = token.charAt(0)
  // U(병합 충돌)·X(알 수 없음)처럼 모르는 글자도 바뀐 파일이다. 신호를 놓치지 않게 M으로 본다.
  return (STATUSES.includes(letter) ? letter : 'M') as ChangeStatus
}

/** `git diff --name-status -M -z` 출력. 이름 바뀜·복사는 `R100\0옛\0새\0` 모양이다. */
export function parseNameStatus(out: string): NameStatusEntry[] {
  const parts = splitNul(out)
  const entries: NameStatusEntry[] = []
  let i = 0
  while (i < parts.length) {
    const token = parts[i++] ?? ''
    if (token === '') continue
    const status = toStatus(token)
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++]
      const newPath = parts[i++]
      if (oldPath === undefined || newPath === undefined) break
      entries.push({ status, path: newPath, old_path: oldPath })
    } else {
      const path = parts[i++]
      if (path === undefined) break
      entries.push({ status, path })
    }
  }
  return entries
}

function parseCount(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null
}

/** `git diff --numstat -M -z` 출력. 이름 바뀜은 `0\t0\t\0옛\0새\0`, 바이너리는 `-\t-\t경로\0`. */
export function parseNumstat(out: string): NumstatEntry[] {
  const parts = splitNul(out)
  const entries: NumstatEntry[] = []
  let i = 0
  while (i < parts.length) {
    const token = parts[i++] ?? ''
    const tab1 = token.indexOf('\t')
    const tab2 = tab1 < 0 ? -1 : token.indexOf('\t', tab1 + 1)
    if (tab2 < 0) continue
    const addedText = token.slice(0, tab1)
    const deletedText = token.slice(tab1 + 1, tab2)
    let path = token.slice(tab2 + 1)
    if (path === '') {
      // 이름 바뀜: 경로가 다음 두 칸(옛, 새)에 온다
      i++
      const newPath = parts[i++]
      if (newPath === undefined) break
      path = newPath
    }
    const binary = addedText === '-' && deletedText === '-'
    const added = parseCount(addedText)
    const deleted = parseCount(deletedText)
    if (!binary && (added === null || deleted === null)) continue
    entries.push({ path, added: added ?? 0, deleted: deleted ?? 0, binary })
  }
  return entries
}

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
}

/** git의 C 따옴표 경로("a/\355\225\234")를 푼다. 8진수는 UTF-8 바이트다. */
function unquoteC(quoted: string): string {
  const bytes: number[] = []
  const encoder = new TextEncoder()
  let i = 1
  while (i < quoted.length) {
    const ch = quoted.charAt(i)
    if (ch === '"') break
    if (ch !== '\\') {
      const code = quoted.codePointAt(i) ?? 0
      const text = String.fromCodePoint(code)
      bytes.push(...encoder.encode(text))
      i += text.length
      continue
    }
    const next = quoted.charAt(i + 1)
    const octal = /^[0-7]{3}/.exec(quoted.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 4
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next] ?? 0)
      i += 2
    } else {
      bytes.push(...encoder.encode(next))
      i += 2
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** `--- a/x`·`+++ b/x`의 경로. `/dev/null`이면 null. */
function headerPath(raw: string, prefix: string): string | null {
  let path: string
  if (raw.startsWith('"')) {
    path = unquoteC(raw)
  } else {
    // 공백이 든 경로 뒤에는 git이 탭을 붙인다. 따옴표 없는 경로에는 탭이 없다.
    const tab = raw.indexOf('\t')
    path = tab < 0 ? raw : raw.slice(0, tab)
    if (path === '/dev/null') return null
  }
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * `git diff -M --no-color --unified=0` 출력. 파일마다 더한 줄과 지운 줄(앞 글자 뺌).
 * 열쇠는 새 경로, 지운 파일은 옛 경로다. 덩어리 머리의 줄 수로 읽어서
 * `--- x`처럼 생긴 내용 줄도 머리로 오해하지 않는다.
 */
export function parsePatch(out: string): Map<string, PatchLines> {
  const files = new Map<string, PatchLines>()
  let minusPath: string | null = null
  let current: PatchLines | null = null
  let oldLeft = 0
  let newLeft = 0
  let at = 0
  for (const line of out.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const mark = line.charAt(0)
      if (mark === '+' && newLeft > 0) {
        current?.added.push(line.slice(1))
        current?.added_at.push(at++)
        newLeft--
        continue
      }
      if (mark === '-' && oldLeft > 0) {
        current?.removed.push(line.slice(1))
        oldLeft--
        continue
      }
      if (mark === '\\') continue
      if (mark === ' ' || line === '') {
        oldLeft = Math.max(0, oldLeft - 1)
        newLeft = Math.max(0, newLeft - 1)
        at++
        continue
      }
      // 줄 수와 맞지 않는 머리가 나오면 덩어리를 닫고 머리로 읽는다
      oldLeft = 0
      newLeft = 0
    }
    if (line.startsWith('diff ')) {
      minusPath = null
      current = null
    } else if (line.startsWith('--- ')) {
      minusPath = headerPath(line.slice(4), 'a/')
    } else if (line.startsWith('+++ ')) {
      const key = headerPath(line.slice(4), 'b/') ?? minusPath
      current = null
      if (key !== null) {
        current = files.get(key) ?? { added: [], removed: [], added_at: [] }
        files.set(key, current)
      }
    } else if (line.startsWith('@@ ')) {
      const m = HUNK.exec(line)
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1])
        at = Number(m[2])
        newLeft = m[3] === undefined ? 1 : Number(m[3])
      }
    }
  }
  return files
}

/** 세 출력을 합쳐 파일마다 상태, 줄 수, 더한·지운 줄을 붙인다. 순서는 name-status를 따른다. */
export function buildDiffFacts(
  base: string,
  head: string,
  nameStatus: string,
  numstat: string,
  patch: string,
): DiffFacts {
  const counts = new Map<string, NumstatEntry>()
  for (const entry of parseNumstat(numstat)) counts.set(entry.path, entry)
  const lines = parsePatch(patch)
  const files: FileChange[] = []
  for (const entry of parseNameStatus(nameStatus)) {
    const count = counts.get(entry.path)
    const patchLines = lines.get(entry.path)
    const added_lines = patchLines?.added ?? []
    const removed_lines = patchLines?.removed ?? []
    const file: FileChange = {
      path: entry.path,
      status: entry.status,
      added: count ? count.added : added_lines.length,
      deleted: count ? count.deleted : removed_lines.length,
      binary: count?.binary ?? false,
      added_lines,
      removed_lines,
    }
    if (patchLines !== undefined && patchLines.added_at.length > 0)
      file.added_at = patchLines.added_at
    if (entry.old_path !== undefined) file.old_path = entry.old_path
    files.push(file)
  }
  return { base, head, files }
}
