import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initScanManager } from './lib/scanManager'
import './styles/global.css'

// Initialize module-level scan manager — subscribes to IPC scan progress
// events at the app level (not tied to RepoNavView lifecycle).
initScanManager()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
