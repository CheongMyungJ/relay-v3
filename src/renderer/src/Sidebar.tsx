// 왼쪽 사이드바 (docs/m2-modules.md 4절): 프로젝트 → Work, 상태 점, [+ 새 Work], 프로젝트 설정 톱니. 품질 기준이 없거나
// 깨진 프로젝트는 그 줄에 알림과 [초안 만들기](V20). 틀은 Astryx SideNav다.
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Text } from '@astryxdesign/core/Text'
import type { ProjectView, WorkView } from '../../shared/api.ts'
import { STATE_LABEL, workTone } from './format.ts'
import { QualityNotice } from './QualityNotice.tsx'
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

export function Sidebar(p: Props) {
  return (
    <SideNav
      aria-label="프로젝트와 Work"
      className="sidebar"
      header={<SideNavHeading heading="relay" subheading="계약과 증거로 맡기기" />}
      footer={
        <Button variant="ghost" label="+ 프로젝트 추가" width="100%" onClick={p.onAddProject} />
      }
    >
      {p.projects.length === 0 ? (
        <div className="sidebar-note">
          <Text type="supporting">프로젝트를 추가하면 여기에 Work가 보입니다.</Text>
        </div>
      ) : null}
      {p.projects.map((project) => {
        const works = p.works.filter((w) => w.project === project.id)
        return (
          <SideNavSection
            key={project.id}
            title={project.name}
            subtitle={project.path}
            className="project"
            data-testid="project"
            endContent={
              <IconButton
                variant="ghost"
                size="sm"
                label={`${project.name} 설정`}
                tooltip="프로젝트 설정"
                icon={<Icon icon="wrench" />}
                onClick={() => p.onSettings(project.id)}
              />
            }
          >
            <QualityNotice project={project} compact />
            <div className="new-work">
              <Button
                variant="secondary"
                size="sm"
                width="100%"
                label="+ 새 Work"
                onClick={() => p.onNewWork(project.id)}
              />
            </div>
            {works.map((w) => (
              <SideNavItem
                key={w.id}
                className="work-item"
                label={w.title}
                isSelected={w.id === p.selected}
                onClick={() => p.onSelect(w.id)}
                endContent={
                  <span className="work-state">
                    <span aria-hidden="true">
                      <Dot tone={workTone(w)} />
                    </span>
                    <Text type="supporting" size="sm">
                      {STATE_LABEL[w.state]}
                    </Text>
                  </span>
                }
              />
            ))}
          </SideNavSection>
        )
      })}
    </SideNav>
  )
}
