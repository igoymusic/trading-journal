import { Component, type ReactNode } from 'react';

/** Keeps one broken piece of the screen from blanking the whole app; shows what went wrong instead. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; onClose?: () => void; closeText?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="chart-message loss error-box">
        <p>Something went wrong showing {this.props.label}: {this.state.error.message}</p>
        {this.props.onClose && <button onClick={this.props.onClose}>{this.props.closeText ?? 'Close'}</button>}
      </div>
    );
  }
}
