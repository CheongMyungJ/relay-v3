// 파싱처럼 실패가 흔한 함수의 결과. 던지지 않고 돌려준다 (docs/m1-modules.md 공통 규칙).

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T = never>(...errors: string[]): Result<T> {
  return { ok: false, errors }
}
