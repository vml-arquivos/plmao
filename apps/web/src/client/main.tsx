import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import '../shared/tokens.css';
import '../shared/ui.css';
import './client.css';
import { applyTheme, readThemePref } from '../shared/theme';
import { ToastProvider } from '../shared/ui';
import { SessionProvider } from './session';
import App from './App';

applyTheme(readThemePref());
if ('serviceWorker' in navigator && import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
