// 렌더러 입구 (docs/m2-modules.md 4절). window.relay(preload)만 쓴다.
// 화면의 부품과 토큰은 Astryx(@astryxdesign/core, 테마 neutral)다. CSS 차례가 층의 차례다:
// reset → 부품(astryx-base) → 테마(astryx-theme) → relay의 틀(층 없음, styles.css·panels.css·dialogs.css).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import { App } from './App.tsx'
import './styles.css'
import './panels.css'
import './dialogs.css'

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <Theme theme={neutralTheme} mode="system">
        <App />
      </Theme>
    </StrictMode>,
  )
