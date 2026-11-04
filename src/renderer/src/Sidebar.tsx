// 왼쪽 사이드바 (docs/m2-modules.md 4절): 프로젝트 → Work, 상태 점, [+ 새 Work], 프로젝트 설정 톱니.
import type { ProjectView, WorkView } from '../../shared/api.ts'
import { STATE_LABEL, workTone } from './format.ts'
import { Dot, GearIcon } from './ui.tsx'

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
    <aside className="sidebar" aria-label="프로젝트와 Work">
      <div className="brand">relay</div>
      <div className="sidebar-scroll">
        {p.projects.length === 0 ? (
          <p className="sidebar-note">프로젝트를 추가하면 여기에 Work가 보입니다.</p>
        ) : null}
        {p.projects.map((project) => {
          const works = p.works.filter((w) => w.project === project.id)
          return (
            <section key={project.id} className="project" data-testid="project">
              <header className="project-head">
                <span className="project-name" title={project.path}>
                  {project.name}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${project.name} 설정`}
                  title="프로젝트 설정"
                  onClick={() => p.onSettings(project.id)}
                >
                  <GearIcon />
                </button>
              </header>
              <button type="button" className="new-work" onClick={() => p.onNewWork(project.id)}>
                + 새 Work
              </button>
              <ul className="work-list">
                {works.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={`work-item${w.id === p.selected ? ' selected' : ''}`}
                      aria-current={w.id === p.selected ? 'true' : undefined}
                      onClick={() => p.onSelect(w.id)}
                    >
                      <Dot tone={workTone(w)} label={STATE_LABEL[w.state]} />
                      <span className="work-text">
                        <span className="work-title">{w.title}</span>
                        <span className="work-sub">{STATE_LABEL[w.state]}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      <footer className="sidebar-foot">
        <button type="button" className="ghost wide" onClick={p.onAddProject}>
          + 프로젝트 추가
        </button>
      </footer>
    </aside>
  )
}
