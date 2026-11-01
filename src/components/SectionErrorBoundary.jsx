import React from 'react';
import * as Sentry from '@sentry/react';

// Catches a crash inside one tab or one big modal, so the rest of the app keeps working.
// Before this the only boundary was the root one (main.jsx → CrashScreen): one malformed
// activity in Home's list threw on every render, and the user got the crash screen again
// after every reload, with no way to reach Settings or another tab.
//
// variant="tab": an inline message in place of the tab, with Try again.
// variant="modal": a full-screen message with Close. Most modals stay mounted and take an
// isOpen prop, so pass `open` — a closed modal's fallback renders nothing — and the
// boundary clears itself whenever `open` changes, giving a reopened modal a fresh start.
// `resetKey` does the same for anything else (a tab boundary needs none: switching tabs
// unmounts it).
export default class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, eventId: null };
    this.reset = this.reset.bind(this);
    this.close = this.close.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const eventId = Sentry.withScope((scope) => {
      scope.setTag('boundary', this.props.name || 'section');
      scope.setExtra('componentStack', info?.componentStack);
      return Sentry.captureException(error);
    });
    this.setState({ eventId: eventId || null });
  }

  componentDidUpdate(prevProps) {
    if (!this.state.error) return;
    if (prevProps.open !== this.props.open || prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset() {
    this.setState({ error: null, eventId: null });
  }

  close() {
    this.props.onClose?.();
    this.reset();
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { variant = 'tab', open = true } = this.props;
    const { eventId } = this.state;

    if (variant === 'modal') {
      if (!open) return null;
      return (
        <div data-modal-overlay className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center px-8 text-center">
          <h2 className="text-white text-lg font-bold mb-2">Something went wrong here</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-xs">
            This screen hit an unexpected error. Your data is safe.
          </p>
          <button
            onClick={this.close}
            className="px-6 py-3 rounded-full font-bold text-black"
            style={{ backgroundColor: '#00FF94' }}
          >
            Close
          </button>
          {eventId && (
            <p className="text-gray-600 text-[10px] mt-6 select-all">Error ID: {eventId}</p>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
        <h2 className="text-white text-lg font-bold mb-2">Something went wrong here</h2>
        <p className="text-gray-400 text-sm mb-6 max-w-xs">
          This screen hit an unexpected error. Your data is safe — the other tabs still work.
        </p>
        <button
          onClick={this.reset}
          className="px-6 py-3 rounded-full font-bold text-black"
          style={{ backgroundColor: '#00FF94' }}
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 px-6 py-2 text-sm text-gray-400"
        >
          Reload app
        </button>
        {eventId && (
          <p className="text-gray-600 text-[10px] mt-6 select-all">Error ID: {eventId}</p>
        )}
      </div>
    );
  }
}
