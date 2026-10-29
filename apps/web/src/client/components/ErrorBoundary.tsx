import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { reportClientError } from '../errorReport';

/** Última rede de proteção: em erro de tela mostra uma saída amigável e avisa o suporte. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { reportClientError('boundary', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ maxWidth: 480, margin: '15vh auto', padding: 24, textAlign: 'center', fontFamily: 'inherit' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Algo deu errado por aqui</h1>
        <p style={{ fontWeight: 300 }}>Já avisamos a equipe. Tente recarregar a página; se continuar, abra o chat de suporte.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
      </div>
    );
  }
}
