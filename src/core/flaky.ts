// 흔들리는 시험 규칙 (V7): head에서 실패하면 한 번 다시, 두 번 실패하면 base와 견준다.
import type { CommandOutcome, CommandRun } from './types.ts'

function passed(run: CommandRun): boolean {
  return run.exit === 0 && !run.timed_out
}

/** base가 돌아서 실패로 끝났는가. 시간 초과·신호로 끝난 것은 실패를 확인한 것이 아니다 */
function failedForSure(run: CommandRun): boolean {
  return run.exit !== null && run.exit !== 0 && !run.timed_out
}

export function needsRerun(first: CommandRun): boolean {
  return !passed(first)
}

/** head의 첫 실행과 (있으면) 다시 실행이 모두 실패했으면 base에서 돌려 본다 */
export function needsBase(head: CommandRun[]): boolean {
  const [first, second] = head
  if (first === undefined || passed(first)) return false
  return second === undefined || !passed(second)
}

export function classify(head: CommandRun[], base: CommandRun | undefined): CommandOutcome {
  const [first, second] = head
  if (first === undefined) return 'not_run'
  if (passed(first)) return 'pass'
  if (second !== undefined && passed(second)) return 'unstable'
  // head가 실패. base에서도 확실히 실패해야 원래 실패로 본다(엄격한 쪽)
  return base !== undefined && failedForSure(base) ? 'pre_existing' : 'fail'
}
