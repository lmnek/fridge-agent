import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Stage from './stage/Stage.tsx'

// Two modes: the kitchen page (the tablet at the fridge) and the stage view (the projector, /stage or ?mode=stage).
const stage = location.pathname.startsWith('/stage') || new URLSearchParams(location.search).get('mode') === 'stage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {stage ? <Stage /> : <App />}
  </StrictMode>,
)
