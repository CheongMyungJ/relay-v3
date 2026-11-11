#!/usr/bin/env node
// 숫자 상한 (docs/design.md 0절 3, philosophy 원칙 5).
// 파일 600줄(소스·시험·스크립트의 .ts .tsx .mjs .js .css), src/core 합계 5,000줄. 넘으면 실패한다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const FILE_MAX = 600
const CORE_MAX = 5000
const DIRS = ['src', 'test', 'scripts']

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js|css)$/.test(name)) out.push(p)
  }
  return out
}

const files = DIRS.flatMap((d) => {
  try {
    return walk(join(ROOT, d), [])
  } catch {
    return []
  }
})
const problems = []
let core = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n').length
  const rel = relative(ROOT, f)
  if (lines > FILE_MAX) problems.push(`${rel}: ${lines}줄 (상한 ${FILE_MAX})`)
  if (rel.startsWith('src/core/') && !rel.endsWith('.test.ts')) core += lines
}
if (core > CORE_MAX) problems.push(`src/core 합계 ${core}줄 (상한 ${CORE_MAX})`)
if (problems.length) {
  console.error('상한을 넘었습니다:\n' + problems.map((p) => `- ${p}`).join('\n'))
  process.exit(1)
}
console.log(`상한 안: 파일 ${files.length}개, src/core ${core}줄`)
