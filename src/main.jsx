import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import './index.css'

// Initialize Sentry for error monitoring
Sentry.init({
  dsn: "https://fd9a09752eb2594bb777168574bdc979@o4510779281637376.ingest.us.sentry.io/4510779290419200",
  // Only send errors in production
  enabled: import.meta.env.PROD,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
