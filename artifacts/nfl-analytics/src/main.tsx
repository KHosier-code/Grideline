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
        logoImageUrl: `${window.location.origin}${import.meta.env.BASE_URL}logo-icon.png`,
      },
      variables: {
        colorPrimary: 'hsl(26, 90%, 55%)',
        colorForeground: 'hsl(224, 45%, 10%)',
        colorMutedForeground: 'hsl(215, 15%, 45%)',
        colorBackground: 'hsl(0, 0%, 100%)',
        colorInput: 'hsl(0, 0%, 100%)',
        colorInputForeground: 'hsl(224, 45%, 10%)',
        colorNeutral: 'hsl(215, 16%, 85%)',
        borderRadius: '0.5rem',
      },
    }}
    localization={{
      signIn: {
        start: {
          title: 'Sign in to Gridline',
          subtitle: 'Welcome back. Continue to NFL analytics.',
        },
      },
      signUp: {
        start: {
          title: 'Create your Gridline account',
          subtitle: 'Set up access to NFL analytics.',
        },
      },
    }}
  >
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ClerkProvider>,
);
