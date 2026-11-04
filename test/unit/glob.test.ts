import { describe, expect, test } from 'vitest'
import { firstMatch, globProblem, matchAny } from '../../src/core/glob.ts'

describe('matchAny', () => {
  test('glob 하나에 맞으면 참', () => {
    expect(matchAny('src/core/a.ts', ['docs/**', 'src/**'])).toBe(true)
  })

  test('어느 glob에도 맞지 않으면 거짓', () => {
    expect(matchAny('src/core/a.ts', ['docs/**', '*.md'])).toBe(false)
  })

  test('glob 목록이 비면 거짓', () => {
    expect(matchAny('src/a.ts', [])).toBe(false)
  })

  test('점으로 시작하는 파일과 폴더도 맞춘다', () => {
    expect(matchAny('.github/workflows/ci.yml', ['**/*.yml'])).toBe(true)
    expect(matchAny('.eslintrc.json', ['**/.eslintrc*'])).toBe(true)
    expect(matchAny('.hidden/a.test.ts', ['**/*.test.*'])).toBe(true)
  })

  test('**/로 시작하는 glob은 루트의 파일에도 맞는다', () => {
    expect(matchAny('package-lock.json', ['**/package-lock.json'])).toBe(true)
    expect(matchAny('a/b/package-lock.json', ['**/package-lock.json'])).toBe(true)
  })

  test('폴더/**는 그 폴더 아래 모든 깊이에 맞는다', () => {
    expect(matchAny('test/a/b/c.ts', ['test/**'])).toBe(true)
    expect(matchAny('src/test/c.ts', ['test/**'])).toBe(false)
  })

  test('*는 경로 구분자를 넘지 않는다', () => {
    expect(matchAny('src/a.ts', ['*.ts'])).toBe(false)
    expect(matchAny('a.ts', ['*.ts'])).toBe(true)
  })

  test('중괄호 펼치기를 쓴다', () => {
    expect(matchAny('src/b.ts', ['src/{a,b}.ts'])).toBe(true)
    expect(matchAny('src/c.ts', ['src/{a,b}.ts'])).toBe(false)
  })

  test('앞의 ./는 떼고 맞춘다', () => {
    expect(matchAny('./src/a.ts', ['src/**'])).toBe(true)
  })

  test('역슬래시는 경로 구분자로 보지 않는다', () => {
    expect(matchAny('src\\a.ts', ['src/*.ts'])).toBe(false)
  })

  test('대소문자를 가린다', () => {
    expect(matchAny('SRC/a.ts', ['src/**'])).toBe(false)
  })

  test('빈 glob은 던지지 않고 아무것에도 맞지 않는다', () => {
    expect(() => matchAny('a.ts', [''])).not.toThrow()
    expect(matchAny('a.ts', [''])).toBe(false)
    expect(matchAny('a.ts', ['', '*.ts'])).toBe(true)
  })

  test('같은 glob을 거듭 써도 결과가 같다', () => {
    const globs = ['src/**/*.ts']
    expect(matchAny('src/x/y.ts', globs)).toBe(true)
    expect(matchAny('src/x/y.js', globs)).toBe(false)
    expect(matchAny('src/x/y.ts', globs)).toBe(true)
  })
})

describe('폴더처럼 쓴 glob', () => {
  test("'/'로 끝나면 그 폴더 아래 모든 깊이에 맞는다", () => {
    expect(matchAny('src/auth/login.ts', ['src/auth/'])).toBe(true)
    expect(matchAny('src/auth/a/b.ts', ['src/auth/'])).toBe(true)
    expect(matchAny('src/authx/a.ts', ['src/auth/'])).toBe(false)
  })

  test('와일드카드 없는 경로는 그 파일과 그 아래에 맞는다', () => {
    expect(matchAny('migrations/001.sql', ['migrations'])).toBe(true)
    expect(matchAny('migrations', ['migrations'])).toBe(true)
    expect(matchAny('CODEOWNERS', ['CODEOWNERS'])).toBe(true)
    expect(matchAny('migrations2/001.sql', ['migrations'])).toBe(false)
    expect(matchAny('a/migrations/001.sql', ['migrations'])).toBe(false)
  })

  test('와일드카드가 있으면 그대로 picomatch로 본다', () => {
    expect(matchAny('test/a.ts', ['test/*.ts'])).toBe(true)
    expect(matchAny('test/a/b.ts', ['test/*.ts'])).toBe(false)
  })

  test("앞의 './'는 glob에서도 뗀다", () => {
    expect(matchAny('src/a.ts', ['./src/'])).toBe(true)
    expect(matchAny('src/a.ts', ['./src'])).toBe(true)
  })

  test("'/'만 있는 glob은 아무것에도 맞지 않는다", () => {
    expect(matchAny('a.ts', ['/'])).toBe(false)
  })
})

describe('globProblem', () => {
  test.each([
    ['/src/auth/**', '레포 루트 기준이라 /로 시작하지 않는다'],
    ['src\\auth\\**', '경로 구분은 /를 쓴다'],
    ['C:/repo/**', '레포 안의 상대 경로여야 함'],
  ])('맞는 파일이 없는 모양은 까닭을 준다 (%s)', (glob, why) => {
    expect(globProblem(glob)).toBe(why)
  })

  test.each(['src/auth/**', 'src/auth/', 'migrations', '**/*.test.*', '!x', '{a,b}/**'])(
    '쓸 수 있는 glob은 null (%s)',
    (glob) => {
      expect(globProblem(glob)).toBeNull()
    },
  )
})

describe('firstMatch', () => {
  test('처음 맞은 glob을 돌려준다', () => {
    expect(firstMatch('src/auth/login.ts', ['docs/**', 'src/auth/**', 'src/**'])).toBe(
      'src/auth/**',
    )
  })

  test('맞는 것이 없으면 null', () => {
    expect(firstMatch('src/a.ts', ['docs/**'])).toBeNull()
    expect(firstMatch('src/a.ts', [])).toBeNull()
  })

  test('빈 glob을 건너뛰고 다음 glob을 본다', () => {
    expect(firstMatch('a.ts', ['', '*.ts'])).toBe('*.ts')
  })
})
