// 레포 경로와 glob 맞추기. 경로는 '/' 구분, 레포 루트 기준이다.
// 폴더처럼 쓴 glob('src/auth/', 와일드카드 없는 'src/auth')은 그 아래도 맞는다.
import picomatch from 'picomatch'

type Matcher = (path: string) => boolean

const cache = new Map<string, Matcher>()

/** picomatch가 특별하게 보는 글자. 하나도 없으면 글자 그대로인 경로다 */
const GLOB_CHARS = /[*?[\]{}()!+@\\]/

function compile(glob: string): Matcher {
  try {
    // windows: false로 실행 OS와 상관없이 같은 결과를 낸다
    return picomatch(glob, { dot: true, windows: false })
  } catch {
    // 빈 glob처럼 picomatch가 거부하는 것은 아무것에도 맞지 않는다
    return () => false
  }
}

function matcher(glob: string): Matcher {
  let m = cache.get(glob)
  if (m === undefined) {
    const g = glob.startsWith('./') ? glob.slice(2) : glob
    if (g.endsWith('/') && g.replace(/\/+$/, '') !== '') {
      m = compile(`${g.replace(/\/+$/, '')}/**`)
    } else if (g !== '' && !GLOB_CHARS.test(g)) {
      const self = compile(g)
      const under = compile(`${g}/**`)
      m = (p) => self(p) || under(p)
    } else {
      m = compile(g)
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

/** quality.json에 쓸 수 없는 glob이면 까닭, 쓸 수 있으면 null. 맞는 파일이 없어 조용히 꺼지는 것을 막는다 */
export function globProblem(glob: string): string | null {
  if (glob.startsWith('/')) return '레포 루트 기준이라 /로 시작하지 않는다'
  if (glob.includes('\\')) return '경로 구분은 /를 쓴다'
  if (/^[A-Za-z]:/.test(glob)) return '레포 안의 상대 경로여야 함'
  return null
}
