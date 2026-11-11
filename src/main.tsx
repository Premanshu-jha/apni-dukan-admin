import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { keys, whenRoleMayHaveChanged } from './api/admin'
import { refreshSession, whenSessionEnds } from './api/client'
import { ApiError, retryDelay } from './api/errors'
import { App } from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdatePrompt } from './components/UpdatePrompt'
import { forgetThisPerson } from './features/auth/signOut'
import { registerWorker } from './lib/swUpdate'
import { followOtherTabs, useSession } from './store/session'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import './index.css'

/**
 * An admin read refused with 403 or 404: maybe this person was taken off the team or made an ordinary admin
 * meanwhile. Re-read /admin/me so the gate and the guards follow (a 404 for a shop that doesn't exist costs one read).
 * Writes do the same through adminApi's shared write path.
 */
function recheckRole(error: unknown, key?: readonly unknown[]) {
  if (key && key[0] === 'admin' && key[1] === 'me') return
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    void queryClient.invalidateQueries({ queryKey: keys.me })
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => recheckRole(error, query.queryKey) }),
  defaultOptions: {
    queries: {
      // Retry network blips, never answers the backend meant (a 4xx is final).
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
      // Waits as long as the backend's Retry-After asks (SERVICE_BUSY), else 1 s, 2 s
      retryDelay,
      refetchOnWindowFocus: true,
      // Try even when the phone says it is offline: a failed try shows "you're offline" instead of waiting silently.
      networkMode: 'always',
    },
    mutations: { networkMode: 'always' },
  },
})

whenRoleMayHaveChanged(() => void queryClient.invalidateQueries({ queryKey: keys.me }))

// The backend ended the session (expired, signed out everywhere, removed from the team): tidy this browser.
whenSessionEnds(() => forgetThisPerson(queryClient))

followOtherTabs(() => forgetThisPerson(queryClient))

/** Start-up: pick up a saved session by swapping its refresh token for a fresh access token. */
async function start() {
  const session = useSession.getState()
  session.restore()
  if (useSession.getState().status === 'starting') {
    const ok = await refreshSession()
    // A network blip at start keeps the saved user; the next call tries the refresh again.
    if (!ok && useSession.getState().refreshToken) useSession.setState({ status: 'signedIn' })
  }
  void registerWorker()
}

void start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <UpdatePrompt />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
