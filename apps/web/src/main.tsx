import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { I18nProvider } from './lib/i18n'
import { EmbedBridgeProvider } from './lib/embedBridge'
import './styles/tokens.css'
import './styles.css'
import './community/community.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <EmbedBridgeProvider>
          <App />
        </EmbedBridgeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
