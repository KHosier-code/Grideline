import { Component, type ReactNode, useState } from 'react';

class DisclosureErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div role="alert" className="consumer-state">
        <p>This evidence could not be loaded.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload page to retry</button>
      </div>;
    }
    return this.props.children;
  }
}

export function DeferredDetailDisclosure({ testId, title, status, children }: {
  testId: string;
  title: string;
  status: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);

  return <details className="detail-disclosure" data-testid={testId}
    onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{title} <small>{status}</small></summary>
    {opened && <DisclosureErrorBoundary>
      {children}
    </DisclosureErrorBoundary>}
  </details>;
}