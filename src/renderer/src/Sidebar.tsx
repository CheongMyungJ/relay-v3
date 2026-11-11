// 왼쪽 사이드바 (docs/m2-modules.md 4절, V78): 프로젝트마다 이름 줄(올리면 [새 Work]와 설정 톱니가 또렷해진다), [+ 새 Work],
// 열린 Work(두 줄: 제목 / 상태 점·상태·만든 때. 답이 필요하면 상태가 눈에 띈다), 끝난 Work는 접는 묶음. 품질 기준이 없거나
// 깨진 프로젝트는 그 줄에 작은 알림과 [초안 만들기](V20). 틀은 Astryx SideNav다.
import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { IconButton } from '@astryxdesign/core/IconButton'
import { SideNav } from '@astryxdesign/core/SideNav'
import { Text } from '@astryxdesign/core/Text'
import { needsAnswer } from '../../shared/answer.ts'
import type { ProjectView, WorkView } from '../../shared/api.ts'
import { STATE_LABEL, workTone } from './format.ts'
import { ChevronIcon, SettingsIcon, PlusIcon, RelayMark } from './icons.tsx'
import { newWorkKeyText } from './keys.ts'
import { QualityNotice } from './QualityNotice.tsx'
import { agoText, doneOpen, splitWorks } from './summary.ts'
import { Dot } from './ui.tsx'

interface Props {
  projects: ProjectView[]
  works: WorkView[]
  selected: string | null
  onSelect: (id: string) => void
  onNewWork: (projectId: string) => void
  onSettings: (projectId: string) => void
  onAddProject: () => void
}

/** 지금 시각. 1분마다 다시 그려 '만든 때'가 낡지 않게 한다 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function WorkItem(p: {
  w: WorkView
  now: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { w } = p
  const needs = needsAnswer(w)
  const closed = w.state === 'done' || w.state === 'abandoned'
  return (
    <button
      type="button"
      className={`work-item${p.selected ? ' selected' : ''}${closed ? ' closed' : ''}`}
      aria-current={p.selected ? 'true' : undefined}
      title={w.title}
      onClick={() => p.onSelect(w.id)}
    >
      <span className="work-title">{w.title}</span>
      <span className={`work-state${needs ? ' needs' : ''}`}>
        <span aria-hidden="true">
          <Dot tone={workTone(w)} />
        </span>
        <span>{needs && w.state === 'working' ? '끝내기 확인' : STATE_LABEL[w.state]}</span>
        <span aria-hidden="true">·</span>
        <span>{agoText(w.createdAt, p.now)}</span>
      </span>
    </button>
  )
}

function Project(p: Props & { project: ProjectView; now: number }) {
  const { project } = p
  const { open, closed } = splitWorks(p.works.filter((w) => w.project === project.id))
  const holds = closed.some((w) => w.id === p.selected)
  const [shown, setShown] = useState<boolean | null>(null)
  const showDone = shown ?? doneOpen(closed.length, holds)
  return (
    <section className="project" data-testid="project" aria-label={project.name}>
      <div className="project-head">
        <span className="project-name" title={project.path}>
          {project.name}
        </span>
        <span className="project-actions">
          <IconButton
            variant="ghost"
            size="sm"
            label={`${project.name} 설정`}
            tooltip="프로젝트 설정"
            icon={<SettingsIcon />}
            onClick={() => p.onSettings(project.id)}
          />
        </span>
      </div>
      <QualityNotice project={project} compact />
      <button
        type="button"
        className="new-work"
        title={`새 Work (${newWorkKeyText()})`}
        onClick={() => p.onNewWork(project.id)}
      >
        <PlusIcon size={14} />새 Work
      </button>
      {open.map((w) => (
        <WorkItem
          key={w.id}
          w={w}
          now={p.now}
          selected={w.id === p.selected}
          onSelect={p.onSelect}
        />
      ))}
      {closed.length > 0 ? (
        <>
          <button
            type="button"
            className="done-toggle"
            aria-expanded={showDone}
            onClick={() => setShown(!showDone)}
          >
            <ChevronIcon size={10} />
            끝난 Work {closed.length}개
          </button>
          {showDone
            ? closed.map((w) => (
                <WorkItem
                  key={w.id}
                  w={w}
                  now={p.now}
                  selected={w.id === p.selected}
                  onSelect={p.onSelect}
                />
              ))
            : null}
        </>
      ) : null}
    </section>
  )
}

export function Sidebar(p: Props) {
  const now = useNow()
  return (
    <SideNav
      aria-label="프로젝트와 Work"
      className="sidebar"
      header={
        <div className="brand">
          <span className="brand-mark">
            <RelayMark />
          </span>
          <span>
            <div className="brand-name">relay</div>
            <div className="brand-sub">계약과 증거로 맡기기</div>
          </span>
        </div>
      }
      footer={
        <Button variant="ghost" label="+ 프로젝트 추가" width="100%" onClick={p.onAddProject} />
      }
    >
      {p.projects.length === 0 ? (
        <div className="sidebar-note">
          <Text type="supporting">프로젝트를 추가하면 여기에 Work가 보입니다.</Text>
        </div>
      ) : null}
      {p.projects.map((project) => (
        <Project key={project.id} {...p} project={project} now={now} />
      ))}
    </SideNav>
  )
}
