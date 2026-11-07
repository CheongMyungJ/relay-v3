// 가짜 claude·gh의 자리 (docs/m2-modules.md 5절). [어댑터]와 [흐름]이 함께 쓴다.
//
//   startPty({ bin: FAKE_CLAUDE, … })                       // Windows는 .cmd(spawnSpec이 cmd.exe로 감싼다)
//   vi.stubEnv('RELAY_GH_BIN', FAKE_GH)                     // src/adapters/gh.ts가 부를 gh
//   const env = await fakeGhOnPath(dir)                     // 세션의 셸이 `gh …`로 찾게 PATH 앞에 둔다

import { chmodSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const here = fileURLToPath(new URL('.', import.meta.url))

export const FAKE_CLAUDE_MJS = join(here, 'fake-claude', 'fake-claude.mjs')
export const FAKE_GH_MJS = join(here, 'fake-gh', 'gh.mjs')

/** 가짜 claude 실행 파일 */
export const FAKE_CLAUDE = isWindows
  ? join(here, 'fake-claude', 'fake-claude.cmd')
  : FAKE_CLAUDE_MJS
/** 가짜 gh 실행 파일 */
export const FAKE_GH = isWindows ? join(here, 'fake-gh', 'gh.cmd') : FAKE_GH_MJS

/** 가짜 uv가 든 폴더(sh 스크립트 `uv`, Windows 없음). PATH 앞에 넣는다: 여러 언어 초안(V60)의 Python(uv) 드라이런 */
export const FAKE_UV_DIR = join(here, 'fake-uv')

// 체크아웃이 실행 비트를 잃었어도 돈다(.mjs는 #!/usr/bin/env node)
if (!isWindows) {
  for (const f of [FAKE_CLAUDE_MJS, FAKE_GH_MJS, join(FAKE_UV_DIR, 'uv')])
    if (existsSync(f)) chmodSync(f, 0o755)
}

/** 이 환경에서 PATH의 이름(Windows는 보통 Path) */
export function pathKey(env: NodeJS.ProcessEnv = process.env): string {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
}

/**
 * dir/bin에 `gh`(Windows는 gh.cmd)라는 이름으로 가짜 gh를 두고, 그 폴더를 앞에 넣은 PATH와 RELAY_GH_BIN을 돌려준다.
 * 세션(가짜 claude의 bash 단계)이 셸에서 `gh pr create`를 부르는 [흐름]에 쓴다
 */
export async function fakeGhOnPath(dir: string): Promise<Record<string, string>> {
  const bin = join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  if (isWindows) {
    await writeFile(
      join(bin, 'gh.cmd'),
      `@echo off\r\n"${process.execPath}" "${FAKE_GH_MJS}" %*\r\n`,
    )
  } else {
    await writeFile(
      join(bin, 'gh'),
      `#!/bin/sh\nexec "${process.execPath}" "${FAKE_GH_MJS}" "$@"\n`,
      {
        mode: 0o755,
      },
    )
  }
  const key = pathKey()
  return {
    [key]: `${bin}${delimiter}${process.env[key] ?? ''}`,
    RELAY_GH_BIN: FAKE_GH,
  }
}
