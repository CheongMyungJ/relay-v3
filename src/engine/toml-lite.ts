// 작은 TOML 읽개 (V69·V70). 초안의 레시피가 읽는 칸(pyproject의 의존성 묶음, Gradle 판 목록의 plugins)만 본다: 표 머리, 점 열쇠,
// 따옴표 열쇠, 여러 줄 배열, 세 겹 따옴표 글(빈 글로 줄임), 주석. 값은 날 글이다. 순수 함수다.

export interface TomlEntry {
  path: string[]
  value: string
}

/** 주석을 지우고 여러 줄 글(세 겹 따옴표)을 빈 글로 줄인다. 한 줄 글은 그대로 둔다 */
function blank(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    const three = text.slice(i, i + 3)
    if (three === '"""' || three === "'''") {
      const end = text.indexOf(three, i + 3)
      out += c + c
      i = end < 0 ? text.length : end + 3
      // 닫는 따옴표 뒤에 따옴표가 더 붙을 수 있다("""a"""")
      while (text[i] === c) i++
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c && text[j] !== '\n')
        j += c === '"' && text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** 따옴표 밖의 괄호 깊이 변화 */
function depthOf(s: string): number {
  let d = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < s.length && s[j] !== c) j += c === '"' && s[j] === '\\' ? 2 : 1
      i = j
    } else if (c === '[' || c === '{') d++
    else if (c === ']' || c === '}') d--
  }
  return d
}

const KEY_PART = `(?:[A-Za-z0-9_-]+|"(?:[^"\\\\]|\\\\.)*"|'[^']*')`
const KEY = new RegExp(`^\\s*(${KEY_PART}(?:\\s*\\.\\s*${KEY_PART})*)\\s*=\\s*(.*)$`)
const HEADER = new RegExp(
  `^\\s*\\[\\[?\\s*(${KEY_PART}(?:\\s*\\.\\s*${KEY_PART})*)\\s*\\]\\]?\\s*$`,
)

function keyPath(key: string): string[] {
  const out: string[] = []
  for (const m of key.matchAll(new RegExp(KEY_PART, 'g'))) {
    const k = m[0]
    out.push(/^["']/.test(k) ? k.slice(1, -1) : k)
  }
  return out
}

/** 열쇠 = 값의 줄들(값은 날 글. 여러 줄 배열은 한 줄로 잇는다) */
export function tomlEntries(text: string): TomlEntry[] {
  const lines = blank(text).split(/\r?\n/)
  const out: TomlEntry[] = []
  let table: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const h = HEADER.exec(line)
    if (h !== null) {
      table = keyPath(h[1] ?? '')
      continue
    }
    const m = KEY.exec(line)
    if (m === null) continue
    let value = m[2] ?? ''
    while (depthOf(value) > 0 && i + 1 < lines.length) value += `\n${lines[++i]}`
    out.push({ path: [...table, ...keyPath(m[1] ?? '')], value: value.trim() })
  }
  return out
}

/** 배열 값의 글(중괄호 밖)과 중괄호 안의 include-group */
export function arrayItems(value: string): { strings: string[]; includes: string[] } {
  const strings: string[] = []
  const includes: string[] = []
  let brace = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < value.length && value[j] !== c) j += c === '"' && value[j] === '\\' ? 2 : 1
      if (brace === 0) strings.push(value.slice(i + 1, j))
      i = j
    } else if (c === '{') {
      if (brace++ === 0) start = i
    } else if (c === '}' && --brace === 0) {
      const g = /include-group\s*=\s*["']([^"']+)["']/.exec(value.slice(start, i))
      if (g?.[1] !== undefined) includes.push(g[1])
    }
  }
  return { strings, includes }
}
