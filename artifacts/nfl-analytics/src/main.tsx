import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemeProvider, useTheme } from '@/lib/theme';

import './index.css';

const clerkPublishableKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function GridlineProviders() {
  const { theme } = useTheme();
  return <ClerkProvider
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
        colorPrimary: theme === 'dark' ? 'hsl(222, 95%, 72%)' : 'hsl(229, 75%, 43%)',
        colorForeground: theme === 'dark' ? 'hsl(225, 25%, 95%)' : 'hsl(226, 35%, 16%)',
        colorMutedForeground: theme === 'dark' ? 'hsl(222, 15%, 73%)' : 'hsl(222, 16%, 38%)',
        colorBackground: theme === 'dark' ? 'hsl(228, 24%, 13%)' : 'hsl(0, 0%, 100%)',
        colorInput: theme === 'dark' ? 'hsl(228, 20%, 18%)' : 'hsl(0, 0%, 100%)',
        colorInputForeground: theme === 'dark' ? 'hsl(225, 25%, 95%)' : 'hsl(226, 35%, 16%)',
        colorNeutral: theme === 'dark' ? 'hsl(224, 16%, 73%)' : 'hsl(220, 16%, 42%)',
        borderRadius: '0.65rem',
      },
    }}
    localization={{
      signIn: { start: { title: 'Sign in to Gridline', subtitle: 'Welcome back. Continue to NFL analytics.' } },
      signUp: { start: { title: 'Create your Gridline account', subtitle: 'Set up access to NFL analytics.' } },
    }}
  ><ErrorBoundary><App /></ErrorBoundary></ClerkProvider>;
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ThemeProvider><GridlineProviders /></ThemeProvider>,
);
