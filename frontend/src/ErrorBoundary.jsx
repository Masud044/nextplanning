import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 700, margin: '3rem auto' }}>
          <h1 style={{ color: '#dc2626' }}>Something went wrong</h1>
          <p style={{ color: '#475569' }}>
            The app hit an unexpected error and could not render. Copy the message below when reporting this.
          </p>
          <pre
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '1rem',
              overflow: 'auto',
              color: '#991b1b',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
            }}
          >
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: '1rem',
              padding: '0.6rem 1.2rem',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
