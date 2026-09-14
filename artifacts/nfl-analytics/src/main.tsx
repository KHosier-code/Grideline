import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const clerkPublishableKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    proxyUrl={clerkProxyUrl}
    appearance={{
      theme: shadcn,
      options: {
        logoPlacement: 'inside',
        logoLinkUrl: import.meta.env.BASE_URL,
        logoImageUrl: `${window.location.origin}${import.meta.env.BASE_URL}logo.svg`,
      },
      variables: {
        colorPrimary: '#f47d30',
        colorForeground: '#172033',
        colorMutedForeground: '#667085',
        colorBackground: '#ffffff',
        colorInput: '#ffffff',
        colorInputForeground: '#172033',
        colorNeutral: '#d8dde7',
        borderRadius: '0.75rem',
      },
    }}
  >
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ClerkProvider>,
);
