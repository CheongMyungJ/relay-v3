// 터미널 출력의 차례와 크기 맞추기. v2 app/src/renderer/src/termSize.ts의 뜻을 v3의 작은 API에 맞춘다.
// v3의 terminal.attach는 최근 출력과 그다음 조각 번호(seq)만 준다(그린 크기 기록은 없다). 그래서:
//   - 붙기 전에 온 조각은 모았다가 지난 출력 뒤에 잇고, seq가 지난 출력에 이미 든 것(seq < backlog.seq)은 버린다.
//   - 지난 출력을 다시 그리는 동안 xterm이 만든 응답(DA1 등)은 세션에 보내지 않는다.
//   - PTY 크기는 화면에 맞춘 xterm이 기준이다. 바뀐 크기만 보낸다(같은 크기를 거듭 보내면 CLI가 다시 그린다).
// DOM을 쓰지 않는다.

export interface TermSize {
  cols: number
  rows: number
}

export function sameSize(a: TermSize | null | undefined, b: TermSize | null | undefined): boolean {
  return !!a && !!b && a.cols === b.cols && a.rows === b.rows
}

/** PTY가 받는 크기인가(sessions.ts는 2보다 작거나 정수가 아니면 버린다) */
export function validSize(s: TermSize): boolean {
  return Number.isInteger(s.cols) && Number.isInteger(s.rows) && s.cols >= 2 && s.rows >= 2
}

export interface Chunk {
  data: string
  seq: number
}

export interface ChunkOrder {
  /** attach의 답. 지난 출력을 쓰고, 기다리던 조각 가운데 뒤의 것만 잇는다. 다 쓰면 done */
  backlog(b: Chunk, done?: () => void): void
  /** 이벤트로 온 조각 */
  chunk(c: Chunk): void
  /** 지난 출력을 쓰는 중(이때 xterm의 응답은 세션에 보내지 않는다) */
  readonly replaying: boolean
}

/**
 * write는 xterm.write처럼 콜백을 받는다(쓴 뒤 부름). 지난 출력보다 먼저 온 조각을 잃지 않고, 겹친 조각을 두 번 쓰지
 * 않는다
 */
export function chunkOrder(write: (data: string, cb?: () => void) => void): ChunkOrder {
  let next = -1
  let replaying = true
  const pending: Chunk[] = []
  const put = (c: Chunk) => {
    if (c.seq < next) return
    next = c.seq + 1
    write(c.data)
  }
  return {
    backlog(b, done) {
      next = b.seq
      write(b.data, () => {
        replaying = false
        done?.()
      })
      for (const c of pending.splice(0).sort((x, y) => x.seq - y.seq)) put(c)
    },
    chunk(c) {
      if (next < 0) pending.push(c)
      else put(c)
    },
    get replaying() {
      return replaying
    },
  }
}

/** 화면에 맞춘 크기를 PTY에 보낼지: 처음이거나 바뀌었을 때만 */
export function sizeSender(send: (s: TermSize) => void): (s: TermSize) => void {
  let last: TermSize | null = null
  return (s) => {
    if (!validSize(s) || sameSize(s, last)) return
    last = { cols: s.cols, rows: s.rows }
    send(last)
  }
}
