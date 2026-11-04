// [어댑터] 앱 저장소 (src/main/store.ts): 같은 파일의 쓰기는 차례로, 읽기는 앞서 줄 선 쓰기 뒤에. Works는 기록(note)을
// 기다리지 않고 남기므로, 그 뒤에 읽는 쪽(화면, 시험, 평가 도구)이 마지막 기록을 놓치지 않아야 한다.
import { randomUUID } from 'node:crypto'
import { afterAll, expect, test } from 'vitest'
import { Store, type WorkRecord } from '../../src/main/store.ts'
import { cleanupAll, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const now = () => '2026-11-04T09:00:00.000Z'

test('기다리지 않은 쓰기 바로 뒤의 읽기도 그 쓰기를 본다(events.jsonl, work.json, 글)', async () => {
  const store = new Store({ home: await makeTempDir('relay-home-'), now, newId: randomUUID })
  const id = randomUUID()
  for (let i = 0; i < 20; i++) void store.appendEvent(id, { type: 'evidence', n: i })
  expect((await store.readEvents(id)).map((e) => e.n)).toEqual([...Array(20).keys()])

  const rec = { version: 1, id, worktree: '/w', title: '처음' } as unknown as WorkRecord
  void store.writeWork(rec)
  void store.writeWork({ ...rec, title: '나중' })
  expect((await store.readWork(id))?.title).toBe('나중')

  void store.writeText(id, 'request.md', '요청\n')
  expect(await store.readText(id, 'request.md')).toBe('요청\n')
})
