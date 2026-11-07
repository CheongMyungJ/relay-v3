// [초안 만들기]의 화면 모양 (V60~V62, docs/m2-modules.md 3절). api.ts가 다시 내보낸다(파일 상한). 타입만 둔다.

/** 초안 화면에 묻는 것(V62): 늘 볼 경로, 지킬 경계, CI 필수 검사. 답은 후보를 고르거나 글로 더 적는다 */
export interface DraftQuestionView {
  id: 'human_paths' | 'boundaries' | 'ci_checks'
  text: string
  hint: string
  options: { value: string; label: string }[]
}

export type DraftAnswersInput = Partial<Record<DraftQuestionView['id'], string[]>>

/** 드라이런으로 돌려 본 명령 하나(V61) */
export interface DraftCommandView {
  id: string
  kind: 'setup' | 'fast' | 'acceptance' | 'ratchet'
  run: string
  ok: boolean
  reason?: string
  duration_ms?: number
}

/**
 * [초안 만들기]의 답(V60~V62): 언어별 레시피로 짠 초안을 지금 커밋에서 한 번 돌려 본 결과. 작업 트리에는 아직 쓰지 않았다.
 * 쓰는 것은 [초안 쓰기](writeQualityDraft)이고 안 된 명령(fixes)은 빠진다. 커밋은 사람이 한다
 */
export interface DraftPreview {
  units: { label: string; dir: string }[]
  /** 돌린 커밋. 커밋이 없으면 null */
  head: string | null
  commands: DraftCommandView[]
  /** 래칫마다 지금 값 */
  values: { id: string; text: string }[]
  /** 초안에서 뺀 것(고칠 것)과 까닭 */
  fixes: DraftCommandView[]
  /** 셋까지 */
  questions: DraftQuestionView[]
  /** 빠진 도구의 제안(설치하지 않는다) */
  suggestions: string[]
  /** 작업 트리에 이미 .relay/quality.json이 있다(쓰면 덮지 않는다) */
  exists: boolean
  /** 쓸 초안의 글(답을 넣기 전) */
  text: string
}

/** [초안 쓰기]의 답(V20). 이미 파일이 있으면 덮지 않고 written false. path는 작업 트리의 .relay/quality.json */
export interface DraftQualityResult {
  written: boolean
  path: string
}
