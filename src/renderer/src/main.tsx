// 렌더러 입구 (docs/m2-modules.md 4절). window.relay(preload)만 쓴다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
import './panels.css'
import './dialogs.css'

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
