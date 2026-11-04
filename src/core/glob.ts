// 레포 경로와 glob 맞추기. 경로는 '/' 구분, 레포 루트 기준이다.
import picomatch from 'picomatch'

type Matcher = (path: string) => boolean

const cache = new Map<string, Matcher>()

function matcher(glob: string): Matcher {
  let m = cache.get(glob)
  if (m === undefined) {
    try {
      // windows: false로 실행 OS와 상관없이 같은 결과를 낸다
      m = picomatch(glob, { dot: true, windows: false })
    } catch {
      // 빈 glob처럼 picomatch가 거부하는 것은 아무것에도 맞지 않는다
      m = () => false
    }
    cache.set(glob, m)
  }
  return m
}

function normalize(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

export function firstMatch(path: string, globs: string[]): string | null {
  const p = normalize(path)
  for (const g of globs) if (matcher(g)(p)) return g
  return null
}

export function matchAny(path: string, globs: string[]): boolean {
  return firstMatch(path, globs) !== null
}
