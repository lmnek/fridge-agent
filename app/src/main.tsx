import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Stage from './stage/Stage.tsx'
import CardsPreview from './stage/cards/Preview.tsx' // part 2: dev preview of the cards at /?cards
import { setScreen } from './realtime.ts'

// Two modes: the kitchen page (the tablet at the fridge) and the stage view (the projector, /stage or ?mode=stage).
const stage = location.pathname.startsWith('/stage') || new URLSearchParams(location.search).get('mode') === 'stage'
if (stage) setScreen('stage')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('cards') ? <CardsPreview /> : stage ? <Stage /> : <App />}
  </StrictMode>,
)
