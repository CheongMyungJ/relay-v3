// [단위] 관문 시험의 바탕: 모든 조건을 채운 깨끗한 증거·계약·정책. 시험마다 사실 하나만 바꾼다.
import { contractHash } from '../../src/core/contract.ts'
import { gate } from '../../src/core/gate.ts'
import type {
  AutoCondition,
  CommandEvidence,
  Contract,
  ContractLine,
  EvidenceBundle,
  GateResult,
  LineVerdict,
  Policy,
  ReviewFinding,
  ServerProtection,
  Signal,
} from '../../src/core/types.ts'

export const C1: ContractLine = {
  id: 'C1',
  kind: 'change',
  text: '바뀜',
  grounds: [],
  examples: ['C1.1'],
  check: 'test',
}
export const C2: ContractLine = { ...C1, id: 'C2', kind: 'new', text: '새로', examples: ['C2.1'] }

export function contract(over: Partial<Contract> = {}): Contract {
  return {
    version: 1,
    id: 'w1',
    goal: '목표',
    lines: [C1, C2],
    non_goals: [],
    human_rules: [],
    examples: [
      { id: 'C1.1', input: 1 },
      { id: 'C2.1', input: 2 },
    ],
    tidy: [],
    approved_by: 'human',
    ...over,
  }
}

export type Kind = LineVerdict['kind']

/** 예시는 줄마다 `<줄>.1` 하나(바탕 계약과 같게). 예시가 없는 줄은 ids에 []를 준다 */
export function verdict(
  line: string,
  status: LineVerdict['status'],
  detail = '',
  kind: Kind = 'change',
  ids: string[] = [`${line}.1`],
): LineVerdict {
  return { line, kind, status, detail, examples: ids.map((id) => ({ id, head: 'passed' })) }
}

export function met(line: string, kind: Kind = 'change'): LineVerdict {
  return verdict(line, 'met', '', kind)
}

export function command(id: string, outcome: CommandEvidence['outcome']): CommandEvidence {
  return { id, outcome, head: [] }
}

export const DIFF: EvidenceBundle['diff'] = {
  files: 2,
  added: 20,
  deleted: 5,
  new_dependencies: [],
  new_modules: [],
  paths: ['src/a.ts', 'test/a.test.ts'],
  binary: [],
}

export const HEAD = 'h'.repeat(40)

export function evidence(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    version: 1,
    repo: '/r',
    base: 'b'.repeat(40),
    head: HEAD,
    created_at: '2026-11-04T00:00:00Z',
    quality: { hash: 'q', from: 'base' },
    contract: { id: 'w1', hash: contractHash(contract()) },
    commands: [command('typecheck', 'pass'), command('lint', 'pass')],
    lines: [met('C1'), met('C2', 'new')],
    groundings: [],
    ratchets: [
      { id: 'tests', status: 'better', base: 1, head: 2, detail: '시험 수 1 → 2' },
      { id: 'file-size', status: 'same', detail: '없음' },
    ],
    signals: [],
    diff: DIFF,
    review: reviewed(),
    claims: null,
    contract_change_requested: false,
    missing: [],
    ...over,
  }
}

export const small: AutoCondition = {
  id: 'small',
  max_changed_lines: 50,
  no_new_dependencies: true,
  no_new_modules: true,
  require_all_lines_tested: true,
}

export const SERVER: ServerProtection = {
  branch_protected: true,
  required_checks: true,
  merge_queue: false,
  up_to_date_required: true,
}

export function policy(over: Partial<Policy> = {}): Policy {
  return {
    auto_merge_enabled: true,
    conditions: [small],
    server: SERVER,
    track_record_ok: { small: true },
    ...over,
  }
}

/**
 * 바탕에서 증거·계약·정책 일부만 바꿔 관문을 돌린다. 묶음의 계약 정보는 넘긴 계약에 맞춘다
 * (e.contract로 바꿀 수 있다). 지금 head는 묶음의 head다.
 */
export function run(
  e: Partial<EvidenceBundle> = {},
  c: Contract | null = contract(),
  p: Partial<Policy> = {},
  head: string | null = e.head ?? HEAD,
): GateResult {
  const made = c === null ? null : { id: c.id, hash: contractHash(c) }
  return gate(evidence({ contract: made, ...e }), c, policy(p), head)
}

export function sig(kind: Signal['kind'], path: string, detail: string): Signal {
  return { kind, path, detail }
}

/** 요청을 본 끝난 리뷰(V30). 자동 후보·그림자가 될 수 있는 리뷰다(V15) */
export function reviewed(findings: ReviewFinding[] = []): NonNullable<EvidenceBundle['review']> {
  return { status: 'done', findings, request: true }
}

export function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return { id: 'f1', severity: 'high', text: '지적', ...over }
}

export function withLine(line: ContractLine): Contract {
  return contract({ lines: [C1, line] })
}
