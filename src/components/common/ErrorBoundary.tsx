import React from 'react';

interface State { error: Error | null }

/** Evita tela em branco: se algo quebrar, mostra o motivo e um botão para recarregar. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Erro na tela:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-[#0f1115] text-slate-100 flex items-center justify-center px-6">
        <div className="w-full max-w-sm bg-[#161920] border border-[#23272f] rounded-xl p-5 space-y-3">
          <h1 className="text-lg font-semibold">Algo deu errado</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            A tela travou, mas a sua carteira e o seu histórico continuam salvos. Recarregue a página. Se repetir, mande esta mensagem:
          </p>
          <pre className="text-xs text-rose-300 bg-[#0f1115] border border-[#23272f] rounded-lg p-3 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
          <button onClick={() => window.location.reload()} className="w-full bg-slate-100 text-slate-900 font-semibold py-3 rounded-lg">Recarregar</button>
        </div>
      </div>
    );
  }
}
