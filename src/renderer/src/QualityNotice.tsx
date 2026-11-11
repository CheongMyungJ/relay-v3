// 품질 기준 알림 (V20, docs/m2-modules.md 4절): 프로젝트의 기본 브랜치에 .relay/quality.json이 없거나 깨졌으면 사이드바의
// 프로젝트 줄과 [증거] 탭 위에 보인다. [초안 만들기]는 언어별 초안을 짜서 지금 커밋에서 한 번 돌려 보고(V60~V62) 초안 화면을
// 연다. 거기서 [초안 쓰기]가 작업 트리에 쓴다(이미 있으면 덮지 않음). 커밋은 사람이 한다. 작업 트리에 초안이 있으면
// (qualityDraft) 단추 대신 커밋하라고 쓴다(기준을 origin/<기본>에서 읽으면 push까지). 기본 브랜치에 들어간 뒤 앱이 다시 재면
// 알림이 사라진다.
import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import type { DraftPreview, ProjectView } from '../../shared/api.ts'
import { DraftDialog } from './DraftDialog.tsx'
import { draftPending, draftResultText, qualityNotice } from './format.ts'
import { ErrorLine, Spinner, useAction } from './ui.tsx'

export function QualityNotice(p: { project: ProjectView; compact?: boolean }) {
  const act = useAction()
  const [drafted, setDrafted] = useState<string | null>(null)
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const text = qualityNotice(p.project.quality)
  if (text === null) return null
  const id = p.project.id
  const draft = () => void act.run(async () => setPreview(await window.relay.draftQuality(id)))
  return (
    <div
      className={`quality-notice${p.compact ? ' compact' : ''}`}
      role="note"
      data-testid="quality-notice"
    >
      <p>{text}</p>
      {drafted || p.project.qualityDraft ? (
        <p className="quality-drafted" data-testid="quality-drafted">
          {drafted ?? draftPending(p.project.qualityRef)}
        </p>
      ) : act.busy ? (
        <Spinner label="초안을 짜고 지금 커밋에서 한 번 돌려 보는 중…" />
      ) : (
        <div className="row">
          <Button
            variant="secondary"
            size={p.compact ? 'sm' : 'md'}
            label="초안 만들기"
            onClick={draft}
          />
        </div>
      )}
      <ErrorLine text={act.error} />
      {preview ? (
        <DraftDialog
          projectName={p.project.name}
          preview={preview}
          onClose={() => setPreview(null)}
          write={(answers) => window.relay.writeQualityDraft(id, answers)}
          onWritten={(r) => {
            setPreview(null)
            setDrafted(draftResultText(r, p.project.qualityRef))
          }}
        />
      ) : null}
    </div>
  )
}
