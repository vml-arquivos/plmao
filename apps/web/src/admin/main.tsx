import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../shared/tokens.css';
import '../shared/ui.css';
import '../shared/report.css';
import './admin.css';
import { applyTheme, readThemePref } from '../shared/theme';
import { ToastProvider } from '../shared/ui';
import { AdminSessionProvider } from './session';
import App from './App';

applyTheme(readThemePref());
// Em desenvolvimento (sem host dedicado) o painel vive em /painel; em produção, na raiz do host administrativo.
const basename = window.location.pathname.startsWith('/painel') ? '/painel' : '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <ToastProvider>
        <AdminSessionProvider>
          <App />
        </AdminSessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
