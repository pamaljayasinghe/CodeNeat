import { Component, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/** Keeps a rendering problem from leaving the user with a blank panel. */
class ErrorBoundary extends Component<{ children: ReactNode }, { message?: string }> {
  state: { message?: string } = {};

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.message) {
      return (
        <div className="loading" role="alert">
          <p>CodeNeat settings ran into a problem and could not be shown.</p>
          <p className="muted">{this.state.message}</p>
          <p>Close this tab and run “CodeNeat: Open Settings” again. Your saved settings are not affected.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
