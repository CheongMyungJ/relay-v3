// 세션 커밋 트레일러의 심 폴더와 git 읽기 (M4e, docs/m4-design.md 7.2). 심의 글은 engine/session-commits.ts shimText가
// 만들고 main/works-session-log.ts가 여기로 넘긴다(adapters는 engine을 가져오지 않는다). 심은 $RELAY_HOME/git-hooks(레포
// 밖)에 두고, 사용자 레포의 설정·훅 파일은 읽지도 바꾸지도 않는다. 세션 프로세스의 환경(GIT_CONFIG_*)만 이 폴더를 가리킨다.

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from './exec.ts'

/** 심 폴더: $RELAY_HOME/git-hooks */
export function hooksDir(home: string): string {
  return join(home, 'git-hooks')
}

/**
 * 심 폴더에 이름마다 글을 쓴다(실행 권한). 같은 글이면 건드리지 않는다: 도는 세션의 git이 읽는 중일 수 있어 임시 파일 뒤
 * rename으로 바꾼다. 폴더를 돌려준다
 */
export async function writeShims(home: string, files: Record<string, string>): Promise<string> {
  const dir = hooksDir(home)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (const [name, text] of Object.entries(files)) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`훅 이름이 잘못됨: ${name}`)
    const path = join(dir, name)
    const now = await readFile(path, 'utf8').catch(() => null)
    if (now === text) {
      await chmod(path, 0o755)
      continue
    }
    const tmp = `${path}.${process.pid}.tmp`
    try {
      await writeFile(tmp, text, { encoding: 'utf8', mode: 0o755 })
      await chmod(tmp, 0o755)
      await rename(tmp, path)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  }
  return dir
}

/** `git --version`의 글 */
export async function gitVersionText(): Promise<string> {
  return (await git(['--version'], process.cwd())).trim()
}

/** worktree가 속한 레포의 공통 git 폴더(절대 경로, git 2.31부터). 심이 이 Work의 레포 커밋인지 견준다 */
export async function gitCommonDir(worktree: string): Promise<string> {
  return (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktree)).trim()
}
