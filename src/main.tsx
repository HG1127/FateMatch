import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { reportErr } from './lib/utils'

window.addEventListener('error', e => reportErr('window', e.error ?? new Error(e.message)))
window.addEventListener('unhandledrejection', e => reportErr('reject', e.reason))

createRoot(document.getElementById('root')!).render(<App />)
