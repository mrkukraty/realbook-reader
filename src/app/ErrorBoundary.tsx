import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; resetKey?: string }
interface State { error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error', error, info.componentStack); }
  componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <div className="fatal-card">
          <h1>Something went wrong</h1>
          <p>The page hit an unexpected problem. Your books are safe: they are stored on this device and nothing was deleted.</p>
          <pre className="fatal-detail">{this.state.error.message}</pre>
          <div className="row">
            <button className="btn btn-primary" onClick={() => this.setState({ error: undefined })}>Try again</button>
            <a className="btn" href="#/library" onClick={() => this.setState({ error: undefined })}>Back to library</a>
            <button className="btn" onClick={() => location.reload()}>Reload app</button>
          </div>
        </div>
      </div>
    );
  }
}
