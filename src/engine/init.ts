// 품질 기준 초안 (docs/m1-modules.md engine init.ts, V19·V20). `relay init`과 앱의 [초안 만들기]가 함께 쓴다.
// 레포의 파일 목록(git이 아는 파일과 무시하지 않는 새 파일)과 작업 트리의 package.json으로 core draftQuality를 부른다.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { git } from '../adapters/exec.ts'
import { draftQuality } from '../core/quality.ts'
import type { QualityConfig } from '../core/types.ts'
import { QUALITY_PATH } from './check.ts'

/** 레포 루트(작업 트리)의 품질 기준 초안 */
export async function draftFor(root: string): Promise<QualityConfig> {
  const listed = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
  const files = listed.split('\0').filter((f) => f !== '')
  const packageJson = await readFile(join(root, 'package.json'), 'utf8').catch(() => undefined)
  return draftQuality(packageJson === undefined ? { files } : { packageJson, files })
}

/** 초안의 글: 들여 쓴 JSON과 끝 줄바꿈 */
export function draftText(q: QualityConfig): string {
  return `${JSON.stringify(q, null, 2)}\n`
}

/** 작업 트리에 `.relay/quality.json`으로 초안을 쓴다. 이미 있으면 덮지 않고 written false */
export async function writeDraft(root: string): Promise<{ written: boolean; path: string }> {
  const path = join(root, QUALITY_PATH)
  const text = draftText(await draftFor(root))
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, text, { flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { written: false, path }
    throw e
  }
  return { written: true, path }
}
