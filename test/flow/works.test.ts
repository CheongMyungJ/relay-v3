// [흐름] Works (src/main/works.ts): Electron 없이 Node에서 조립해 한 Work의 생애를 끝까지 돌린다.
// 가짜 claude(PTY, 훅, control에 직접 MCP 도구 호출, 커밋, -p 리뷰), 가짜 gh(PR), 실제 git 임시 레포와 bare origin.
// 경우: 새 Work → 계약(틀림 → 고침) → 승인 → 커밋·Stop → 증거 → PR → 내보내기 증거(리뷰) → 머지 → done과 장부,
// 정책의 자동 머지, 계약 바꾸기 요청과 답, 바닥 막기(PreToolUse 응답), 앱 재시작 뒤 --resume.
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { contractHash, examplesFileText } from '../../src/core/contract.ts'
import { trackRecord } from '../../src/core/ledger.ts'
import { REVIEW_PROMPT_VERSION } from '../../src/core/review.ts'
import { EVENTS, type WorkView } from '../../src/shared/api.ts'
import { makeTempDir, runGit } from '../support/repo.ts'
import { jsonl } from '../support/works-app.ts'
import {
  CLAUDE_VERSION,
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  RELAY_VERSION,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, mcpResults, until } = kit
const openApp = (home: string, prPollMs?: number) => kit.openApp(home, { prPollMs })

// ── 경우 ────────────────────────────────────────────────────────────────────

describe('한 Work의 생애', () => {
  let home: string
  let projectId: string

  beforeAll(async () => {
    home = await makeTempDir('relay-home-')
  })

  test('새 Work → 계약(틀림 → 고침) → 승인 → 커밋·Stop → 증거 → PR → 리뷰 → [머지] → done, 장부', async () => {
    await scenario({
      start: [
        { do: 'mcp', tool: 'submit_contract', args: { ...CONTRACT, lines: [], examples: [] } },
        { do: 'mcp', tool: 'submit_contract', args: { ...CONTRACT, id: 'fix-clamp' } },
        { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
        FIX_COMMIT,
        { do: 'stop' },
        { do: 'waitInput' },
        ...PUSH_AND_PR,
        { do: 'stop' },
      ],
    })
    const app = await openApp(home)
    const { works } = app
    const project = await app.works.addProject(kit.repo.path('src'))
    projectId = project.id
    expect(project).toMatchObject({ path: kit.repo.dir, defaultBranch: 'main' })
    expect(project.settings).toEqual({
      auto_merge: false,
      min_shadow: 20,
      review: 'all',
      merge_method: 'squash',
      question_mode: 'confirm_each',
      m3: { knowledge: true, debt: true },
    })

    const created = await works.createWork({
      project: project.id,
      request: REQUEST,
      hint: '버그 고침',
    })
    const id = created.id
    expect(created).toMatchObject({ state: 'drafting', base: 'main', title: REQUEST })
    expect(created.branch).toMatch(/^relay\/clamp-fix-hi-lo-[0-9a-f]{4}$/)
    expect(created.contractId).toBe(created.branch.slice('relay/'.length))
    const request = await app.store.readText(id, 'request.md')
    expect(request).toBe(`${REQUEST}\n\n## 일의 성격 제안\n\n버그 고침\n`)

    // 세션: 인자 순서(--mcp-config는 --settings 앞, 첫 프롬프트는 끝), 지침, 훅 토큰, worktree
    await until(async () => (await fake()).some((e) => e.type === 'start'), '세션 시작')
    const start = (await fake()).find((e) => e.type === 'start') as Entry
    const args = start.args as string[]
    expect(args.slice(0, 2)).toEqual(['--dangerously-skip-permissions', '--session-id'])
    expect(args.indexOf('--mcp-config')).toBeLessThan(args.indexOf('--settings'))
    expect(start.prompt).toContain(app.store.workPath(id, 'request.md'))
    expect(args.at(-1)).toBe(start.prompt)
    expect(start.instructions).toContain(`Work branch: \`${created.branch}\``)
    expect(start.instructions).toContain(`[${created.contractId}:C1.1]`)
    expect(start.token).toBe(true)
    expect(start.cwd).toBe(app.store.worktreeDir(id))
    expect(await runGit(start.cwd as string, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      created.branch,
    )
    // 작업 브랜치는 기준 브랜치를 따라가지 않는다(인자 없는 git push가 기준으로 가지 않게)
    await expect(
      runGit(start.cwd as string, ['rev-parse', '--abbrev-ref', '@{u}']),
    ).rejects.toThrow()
    // 기준의 quality.json이 적은 JUnit 출력은 레포의 exclude에 든다(M2.1 13절. 무시되는지는 [어댑터])
    const exclude = await runGit(start.cwd as string, ['rev-parse', '--git-path', 'info/exclude'])
    expect(await readFile(exclude, 'utf8')).toContain('\n/.relay-out/junit.xml\n')

    // 틀린 계약과 지침이 준 것과 다른 id(V11)는 바로 invalid, 고친 계약은 사람의 답을 기다린다
    await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
    const invalid = await mcpResults('submit_contract')
    expect(invalid[0]).toMatchObject({
      status: 'invalid',
      errors: ['lines: 줄이 하나 이상 있어야 함'],
    })
    expect(invalid[1]).toEqual({
      status: 'invalid',
      errors: [
        `id: must be "${created.contractId}", the contract id given in your instructions (got "fix-clamp")`,
      ],
    })
    expect(works.waiting(id)).toBe('submit')
    const pending = works.view(id)
    expect(pending.pendingContract?.id).toBe(created.contractId)
    expect(pending.groundings?.map((g) => [g.line, g.ground.type, g.ok])).toEqual([
      ['C1', 'code', true],
      ['C1', 'request', true],
      ['C2', 'guess', false],
    ])
    expect(
      app.emitted.some(
        (e) => e.event === EVENTS.work && (e.payload as WorkView).state === 'awaiting_approval',
      ),
    ).toBe(true)
    // 예시 자료(V27): 제출이 형식 검사를 지나면 앱이 초안을 worktree에 쓴다. 커밋하지 않는다
    const examplesPath = `.relay/examples/${created.contractId}.json`
    const examplesOnDisk = () => readFile(join(start.cwd as string, examplesPath), 'utf8')
    if (!pending.pendingContract) throw new Error('제출된 계약이 없음')
    expect(await examplesOnDisk()).toBe(examplesFileText(pending.pendingContract))
    expect(await runGit(start.cwd as string, ['status', '--porcelain'])).toBe('?? .relay/examples/')

    await works.approveContract(id)
    await until(async () => (await mcpResults('submit_contract')).length === 3, '승인 답')
    const approved = (await mcpResults('submit_contract'))[2] as Entry & { contract: Entry }
    expect(approved.status).toBe('approved')
    expect(approved.contract).toMatchObject({ id: created.contractId, approved_by: 'human' })
    // 승인 답은 승인본을 쓴 경로와 '바꾸지 말고 시험과 함께 커밋하라'를 담는다
    expect(approved.examples_file).toBe(examplesPath)
    expect(approved.note).toBe(
      `relay wrote the approved examples to ${examplesPath}. Do not edit this file; commit it with the tests that read it.`,
    )
    expect(JSON.parse((await app.store.readText(id, 'contract.json')) ?? '')).toEqual(
      approved.contract,
    )
    expect(works.view(id)).toMatchObject({ state: 'working', pendingContract: null })

    // 커밋 뒤 Stop → debounce → 증거(내보내기 아님). 세션이 쉬고 명령·줄이 모두 통과했으니 미리 리뷰(V23)가 붙는다
    await until(
      async () => (await fake()).some((e) => e.type === 'hook' && e.event === 'Stop'),
      'Stop',
    )
    const head = await runGit(start.cwd as string, ['rev-parse', 'HEAD'])
    await until(
      () =>
        works.view(id).evidence?.head === head &&
        works.view(id).evidence?.review !== null &&
        settled(works.view(id)),
      '첫 증거와 미리 리뷰',
    )
    let v = works.view(id)
    expect(v.evidence?.lines?.map((l) => [l.line, l.status])).toEqual([
      ['C1', 'met'],
      ['C2', 'met'],
    ])
    // 세션이 앱이 쓴 예시 자료를 함께 커밋했다
    expect(v.evidence?.examples_file).toEqual({ path: examplesPath, status: 'same', diffs: [] })
    // 리뷰어는 요청을 인용한 자료로 받았고(V30), 앱이 리뷰 결과에 그것을 적는다: 그래야 자동 후보·그림자가 된다(V15)
    expect(v.evidence?.review).toEqual({
      status: 'done',
      findings: [{ id: 'R1', severity: 'low', text: '이름이 짧음', file: 'src/calc.js', line: 5 }],
      prompt_version: REVIEW_PROMPT_VERSION,
      request: true,
    })
    const asked = (await fake()).find((e) => e.type === 'review')
    expect(asked?.prompt).toContain(`## Request\n\n`)
    expect(asked?.prompt).toContain(
      `\n> ${REQUEST}\n> \n> ## 일의 성격 제안\n> \n> 버그 고침\n\n## Contract`,
    )
    // 리뷰의 토큰은 events.jsonl에만 남긴다(리뷰는 대화 기록을 남기지 않는다). 증거 묶음에는 넣지 않는다
    const reviewed = (await app.store.readEvents(id)).find((e) => e.type === 'review')
    expect(reviewed).toMatchObject({ trigger: 'prepared', status: 'done', findings: 1 })
    expect(reviewed?.usage).toMatchObject({ input_tokens: 1000, output_tokens: 50 })
    // 미리 리뷰로 자동 조건을 채워도(그림자) 내보내기가 아니면 장부에 쓰지 않는다(V23)
    expect(v.gate).toMatchObject({ conclusion: 'human_merge', condition: 'small', shadow: true })
    expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
    expect(await app.store.readLedger()).toEqual([])
    expect(v.head).toBe(head)

    // 세션이 push하고 PR을 연다 → 내보내기 후보: 같은 head·계약의 증거와 미리 리뷰를 다시 쓴다(claude -p 한 번)
    app.sessions.write(id, 'go\r')
    await until(
      () => works.find(id)?.exports[0]?.exported_head === head && settled(works.view(id)),
      '내보내기 증거',
    )
    v = works.view(id)
    expect(v.pr).toMatchObject({ number: 1, state: 'OPEN', headRefOid: head, baseRefName: 'main' })
    expect(v.evidence?.review?.findings).toEqual([
      { id: 'R1', severity: 'low', text: '이름이 짧음', file: 'src/calc.js', line: 5 },
    ])
    expect(v.evidence?.review).not.toHaveProperty('usage')
    expect((await fake()).filter((e) => e.type === 'review')).toHaveLength(1)
    const reviews = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
    expect(reviews.map((e) => [e.trigger, e.reused ?? false])).toEqual([
      ['prepared', false],
      ['pr', true],
    ])
    const measured = (await app.store.readEvents(id)).filter((e) => e.type === 'evidence')
    expect(measured.map((e) => [e.export, e.reused ?? false])).toEqual([
      [false, false],
      [true, true],
    ])
    expect(v.gate).toEqual({
      conclusion: 'human_merge',
      decisive: '프로젝트에서 자동 머지가 꺼져 있음',
      reasons: [
        '프로젝트에서 자동 머지가 꺼져 있음',
        '서버 보호를 확인하지 못함',
        '조건 small의 그림자 실적이 기준에 못 미침',
      ],
      condition: 'small',
      shadow: true,
    })
    const review = (await fake()).find((e) => e.type === 'review') as Entry
    expect(review.cwd).toBe(start.cwd)
    expect(review.args).toEqual(expect.arrayContaining(['--tools', 'Read,Grep,Glob']))
    expect(review.prompt).toContain(`"id": "${created.contractId}"`)
    // 리뷰어에게 주는 증거 사실은 영어
    expect(review.prompt).toContain('- command unit: pass')
    expect(review.args).toEqual(expect.arrayContaining(['--setting-sources', 'user']))
    // 리뷰는 세션에 넣지 않는다: 세션이 받은 입력은 사람이 친 'go'뿐
    expect((await fake()).filter((e) => e.type === 'input').map((e) => e.text)).toEqual(['go'])

    // [머지]: gh pr merge --squash --match-head-commit, 장부, done, 세션 끝
    expect(await works.merge(id)).toEqual({ ok: true })
    v = works.view(id)
    expect(v.state).toBe('done')
    expect(v.pr?.state).toBe('MERGED')
    const merges = (await jsonl(kit.ghLog)).filter((e) => (e.args as string[])[1] === 'merge')
    expect(merges.map((e) => e.args)).toEqual([
      ['pr', 'merge', '1', '--squash', '--match-head-commit', head],
    ])
    await until(() => !app.sessions.isRunning(id), '세션 끝')
    expect(works.view(id).session).toBe('stopped')

    const ledger = await app.store.readLedger()
    // 장부: 내보내기의 그림자 결론과 사람의 머지만(Stop의 재기는 쓰지 않는다, V23)
    expect(
      ledger.map((e) => [e.head === head, e.conclusion, e.condition, e.shadow, e.by ?? null]),
    ).toEqual([
      [true, 'human_merge', 'small', true, null],
      [true, 'human_merge', null, false, 'human'],
    ])
    expect(ledger.at(-1)).toMatchObject({ project: projectId, work: id, merged_head: head })
    const current = { claude_version: CLAUDE_VERSION, relay_version: RELAY_VERSION }
    expect(trackRecord(ledger, projectId, 1, current)).toEqual({ small: true })
    expect(trackRecord(ledger, projectId, 20, current)).toEqual({ small: false })
    const events = (await app.store.readEvents(id)).map((e) => e.type)
    expect(events).toEqual(
      expect.arrayContaining([
        'created',
        'started',
        'contract_invalid',
        'contract_approved',
        'examples_written',
        'evidence',
        'review',
        'merged',
      ]),
    )
  })

  test('자동 머지: 스위치·서버 보호·그림자 실적을 모두 채우면 정책이 머지한다', async () => {
    await scenario({
      start: [
        { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
        FIX_COMMIT,
        ...PUSH_AND_PR,
        { do: 'stop' },
      ],
    })
    const checks = { enforcement_level: 'everyone', contexts: ['ci'], strict: true }
    await kit.gh((state) => {
      state.branches = { main: { protected: true, protection: { required_status_checks: checks } } }
    })
    const app = await openApp(home)
    // 앞 시험이 사람 머지로 그림자 일치 하나를 남겼다
    expect((await app.store.readLedger()).some((e) => e.by === 'human')).toBe(true)
    await app.works.updateSettings(projectId, { auto_merge: true, min_shadow: 1 })
    await expect(app.works.updateSettings(projectId, { min_shadow: -1 })).rejects.toThrow(
      /min_shadow/,
    )
    const { id } = await app.works.createWork({ project: projectId, request: REQUEST })
    await until(() => app.works.view(id).state === 'awaiting_approval', '계약 제출')
    await app.works.approveContract(id)
    await until(() => app.works.view(id).state === 'done', '자동 머지')
    const v = app.works.view(id)
    expect(v.gate).toMatchObject({
      conclusion: 'auto_merge_candidate',
      condition: 'small',
      shadow: false,
    })
    expect(v.pr).toMatchObject({ number: 2, state: 'MERGED' })
    const last = (await app.store.readLedger()).at(-1)
    expect(last).toMatchObject({ work: id, by: 'policy', merged_head: v.evidence?.head })
  })
})

test('PR이 앱 밖(GitHub)에서 머지되면 PR 확인이 알아채 done으로 두고 장부에 human-override로 남긴다', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    ...PUSH_AND_PR,
    { do: 'stop' },
  ])
  const app = await openApp(await makeTempDir('relay-home-'), 200)
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(
    () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
    '내보내기 증거',
  )
  const pr = works.view(id).pr
  expect(pr?.state).toBe('OPEN')
  // 사람이 GitHub에서 머지한다
  await kit.gh((state) => {
    const target = state.prs?.find((p) => p.number === pr?.number)
    if (target) Object.assign(target, { state: 'MERGED', mergedAt: '2026-11-04T10:00:00Z' })
  })
  await until(() => works.view(id).state === 'done', 'PR 확인')
  expect(works.view(id).pr?.state).toBe('MERGED')
  expect((await app.store.readLedger()).at(-1)).toMatchObject({
    work: id,
    by: 'human-override',
    merged_head: pr?.headRefOid,
  })
  await until(() => !app.sessions.isRunning(id), '세션 끝')
})

test('계약 바꾸기: 세션의 요청 → recontract(관문도 recontract) → 사람이 받아들이면 새 계약으로 working, 같은 head를 새 계약으로 다시 잰다', async () => {
  const REVISED = { ...CONTRACT, lines: [CONTRACT.lines[0]], examples: [CONTRACT.examples[0]] }
  const reason = 'C2는 이 Work와 상관없음'
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    { do: 'mcp', tool: 'request_contract_change', args: { reason: ' ' } },
    // 새 계약 없이, 또는 승인된 계약 그대로는 받지 않는다(받아들여도 바뀌는 게 없음)
    { do: 'mcp', tool: 'request_contract_change', args: { reason } },
    { do: 'mcp', tool: 'request_contract_change', args: { reason, contract: CONTRACT } },
    { do: 'mcp', tool: 'request_contract_change', args: { reason, contract: REVISED } },
    { do: 'stop' },
  ])
  const app = await openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).state === 'recontract', '계약 바꾸기 요청')
  expect((await mcpResults('request_contract_change')).slice(0, 3)).toEqual([
    { status: 'invalid', errors: ['reason: 필요함', 'contract: 필요함'] },
    { status: 'invalid', errors: ['contract: 필요함'] },
    {
      status: 'invalid',
      errors: ['contract: 승인된 계약과 같음(바꿀 곳을 고친 계약 전체를 낸다)'],
    },
  ])
  let v = works.view(id)
  expect(v.pendingChange).toBe(reason)
  expect(v.pendingContract?.lines.map((l) => l.id)).toEqual(['C1'])
  expect(v.contract?.change_requested).toBe(reason)
  expect(works.waiting(id)).toBe('change')
  // 그사이 잰 증거는 계약 변경 요청을 담고 관문은 recontract
  await works.runEvidence(id, { exportCandidate: false })
  v = works.view(id)
  expect(v.evidence?.contract_change_requested).toBe(true)
  expect(v.gate?.conclusion).toBe('recontract')
  // [머지]는 구현 중일 때만
  expect(await works.merge(id)).toEqual({ ok: false, error: '구현 중인 Work만 머지할 수 있음' })
  // [끝내기](V25): 풀리지 않은 계약 변경 요청은 열린 것이라 상자가 뜬다
  expect(await works.end(id)).toMatchObject({ armed: true })
  await until(() => works.view(id).endPending?.armed === false, '끝내기 상자')
  expect(works.view(id).endPending?.open[0]).toBe(`계약 변경 요청: ${reason}`)

  await works.answerChange(id, { approved: true, message: '좋아요' })
  // 계약이 바뀌었으니 앞 계약의 증거로 정한 상자는 지운다
  expect(works.view(id).endPending).toBeNull()
  expect((await app.store.readEvents(id)).filter((e) => e.type === 'end_cancelled')).toMatchObject([
    { armed: false, reason: 'contract' },
  ])
  await until(async () => (await mcpResults('request_contract_change')).length === 4, '답')
  const answer = (await mcpResults('request_contract_change'))[3] as Entry
  expect(answer).toMatchObject({ status: 'approved', message: '좋아요' })
  v = works.view(id)
  expect(v).toMatchObject({ state: 'working', pendingChange: null, pendingContract: null })
  expect(v.contract).toEqual({
    ...REVISED,
    id: v.contractId,
    approved_by: 'human',
    approved_at: expect.any(String),
  })
  expect(answer.contract).toEqual(v.contract)
  expect(JSON.parse((await app.store.readText(id, 'contract.json')) ?? '')).toEqual(v.contract)
  // 받아들인 새 계약의 예시 자료를 worktree에 다시 쓴다(V27)
  if (!v.contract) throw new Error('계약이 없음')
  expect(answer.examples_file).toBe(`.relay/examples/${v.contractId}.json`)
  expect(
    await readFile(join(app.store.worktreeDir(id), `.relay/examples/${v.contractId}.json`), 'utf8'),
  ).toBe(examplesFileText(v.contract))
  expect(Object.keys(JSON.parse(examplesFileText(v.contract)) as object)).toEqual(['C1.1'])
  const written = (await app.store.readEvents(id)).filter((e) => e.type === 'examples_written')
  expect(written.map((e) => e.kind)).toEqual(['draft', 'approved', 'approved'])
  // 받아들인 새 계약의 근거 확인을 그대로 보인다(요청 때 확인한 것)
  expect(v.groundings?.map((g) => [g.line, g.ground.type, g.ok])).toEqual([
    ['C1', 'code', true],
    ['C1', 'request', true],
  ])
  // head는 그대로지만 계약이 바뀌었다: 옛 계약(recontract)의 관문이 남지 않게 다시 잰다
  await until(
    () => works.view(id).gate?.conclusion !== 'recontract' && settled(works.view(id)),
    '새 계약으로 다시 잼',
  )
  v = works.view(id)
  if (!v.contract) throw new Error('계약이 없음')
  expect(v.evidence?.contract).toEqual({ id: v.contractId, hash: contractHash(v.contract) })
  expect(v.evidence?.contract_change_requested).toBe(false)
})

test('바닥 막기: 지킬 브랜치 push, 강제 push, PR 머지는 PreToolUse에서 deny로 막고 다른 명령은 그대로 돈다', async () => {
  await scenario([
    { do: 'bash', command: 'git status --short' },
    { do: 'bash', command: 'git push --force origin main' },
    { do: 'bash', command: 'git push origin HEAD:main' },
    { do: 'bash', command: 'gh pr merge 1 --squash' },
    { do: 'stop' },
  ])
  const before = await kit.repo.git('ls-remote', 'origin', 'refs/heads/main')
  const app = await openApp(await makeTempDir('relay-home-'))
  const project = await app.works.addProject(kit.repo.dir)
  const { id } = await app.works.createWork({ project: project.id, request: REQUEST })
  await until(
    async () => (await fake()).some((e) => e.type === 'hook' && e.event === 'Stop'),
    'Stop',
  )
  const log = await fake()
  expect(log.filter((e) => e.type === 'bash').map((e) => [e.command, e.code])).toEqual([
    ['git status --short', 0],
  ])
  const denied = log.filter((e) => e.type === 'denied')
  expect(denied.map((e) => e.command)).toEqual([
    'git push --force origin main',
    'git push origin HEAD:main',
    'gh pr merge 1 --squash',
  ])
  for (const d of denied) expect(d.reason).toMatch(/relay/)
  const pre = log.filter((e) => e.type === 'hook' && e.event === 'PreToolUse')
  expect(
    pre.map(
      (e) =>
        (e.response as { hookSpecificOutput?: Entry } | null)?.hookSpecificOutput
          ?.permissionDecision ?? null,
    ),
  ).toEqual([null, 'deny', 'deny', 'deny'])
  expect(await kit.repo.git('ls-remote', 'origin', 'refs/heads/main')).toBe(before)
  const blocked = (await app.store.readEvents(id)).filter((e) => e.type === 'blocked')
  expect(blocked.map((e) => e.command)).toEqual(denied.map((e) => e.command))
  // 계약 전(drafting)의 Stop은 증거를 재지 않는다
  expect(app.works.view(id)).toMatchObject({ state: 'drafting', session: 'idle', evidence: null })
  // [버림]: 세션을 끝내고 다시 열 수 없다
  await app.works.abandon(id)
  expect(app.works.view(id)).toMatchObject({ state: 'abandoned', session: 'stopped' })
  await expect(app.works.resumeWork(id)).rejects.toThrow('끝난 Work는 다시 열 수 없음')
})

test('앱을 다시 켜면 세션은 stopped, [다시 열기]는 --resume과 새 포트·토큰으로 띄우고 기다리던 제출을 다시 부르게 한다', async () => {
  await scenario({
    start: [{ do: 'mcp', tool: 'submit_contract', args: CONTRACT }],
    resume: [{ do: 'mcp', tool: 'submit_contract', args: CONTRACT }, { do: 'stop' }],
  })
  const home = await makeTempDir('relay-home-')
  const first = await openApp(home)
  const project = await first.works.addProject(kit.repo.dir)
  const { id } = await first.works.createWork({ project: project.id, request: REQUEST })
  await until(() => first.works.view(id).state === 'awaiting_approval', '계약 제출')
  const started = (await fake()).find((e) => e.type === 'start') as Entry
  await first.close()
  kit.forget(first)
  // 세션의 claude가 끝났다(SIGHUP → SessionEnd)
  expect((await fake()).some((e) => e.type === 'hook' && e.event === 'SessionEnd')).toBe(true)

  const second = await openApp(home)
  const { works } = second
  expect(works.list().works.map((w) => w.id)).toEqual([id])
  expect(works.view(id)).toMatchObject({ session: 'stopped', state: 'awaiting_approval' })
  expect(works.view(id).pendingContract?.id).toBe(works.view(id).contractId)
  expect(works.waiting(id)).toBeNull()

  await works.resumeWork(id)
  await until(async () => (await fake()).filter((e) => e.type === 'start').length === 2, '재개')
  const resumed = (await fake()).filter((e) => e.type === 'start')[1] as Entry
  const args = resumed.args as string[]
  expect(resumed.resume).toBe(true)
  expect(resumed.sessionId).toBe(started.sessionId)
  expect(args.slice(0, 3)).toEqual([
    '--dangerously-skip-permissions',
    '--resume',
    started.sessionId,
  ])
  expect(args.indexOf('--mcp-config')).toBeLessThan(args.indexOf('--settings'))
  expect(resumed.prompt).toMatch(/Call submit_contract again/)
  const mcp = JSON.parse((await second.store.readText(id, 'mcp.json')) ?? '') as {
    mcpServers: { relay_work: { env: Record<string, string> } }
  }
  expect(mcp.mcpServers.relay_work.env).toMatchObject({
    RELAY_CONTROL_URL: `http://127.0.0.1:${second.port}/control`,
    RELAY_CONTROL_TOKEN: works.controlToken(id),
    RELAY_WORK_ID: id,
  })
  // control 토큰은 Work마다·띄울 때마다 새로 만들고, 그 파일은 다른 사용자가 읽지 못한다
  expect(works.controlToken(id)).toMatch(/^[0-9a-f]{48}$/)
  if (process.platform !== 'win32')
    expect((await stat(second.store.workPath(id, 'mcp.json'))).mode & 0o777).toBe(0o600)
  expect(await second.store.readText(id, 'settings.json')).toContain(
    `127.0.0.1:${second.port}/hook/${id}/Stop`,
  )

  await until(() => works.waiting(id) === 'submit', '다시 제출')
  await works.approveContract(id)
  await until(
    async () => (await mcpResults('submit_contract')).some((r) => r.status === 'approved'),
    '승인',
  )
  expect(works.view(id).state).toBe('working')
  expect(second.sessions.backlog(id).data).toContain('FAKE-CLAUDE READY')
  expect(existsSync(second.store.worktreeDir(id))).toBe(true)
})
