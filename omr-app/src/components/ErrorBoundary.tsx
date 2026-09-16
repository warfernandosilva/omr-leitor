import React from 'react';

interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card max-w-2xl mx-auto text-center py-8">
          <p className="text-red-600 font-medium">Erro inesperado nesta tela</p>
          <p className="text-sm text-gray-500 mt-2">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary mt-4">Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
