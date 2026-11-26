import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { leadKeys } from '../../api/leads'
import { CHECK_EVERY_MS, MIN_GAP_MS } from './liveUpdates'
import { useLeads } from './store'

/** When the last check started (ms), shared by every mount: leaving and coming back doesn't check twice in a row. */
let lastCheck = 0

/**
 * Keeps the searched areas up to date while the Leads page is on screen: checks right away (after a reload, after
 * coming back to the page or the tab), then every 30 seconds; never while the tab is hidden or the phone is locked.
 * When an area changed, the areas' counts and the funnel are read again too.
 */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  const checkChanges = useLeads((s) => s.checkChanges)
  const hydrating = useLeads((s) => s.hydrating)
  const anySearched = useLeads((s) => Object.keys(s.scans).length > 0)

  useEffect(() => {
    if (hydrating || !anySearched) return
    const run = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < MIN_GAP_MS) return
      lastCheck = Date.now()
      if ((await checkChanges()) > 0) {
        void queryClient.invalidateQueries({ queryKey: [...leadKeys.all, 'areas'] })
        void queryClient.invalidateQueries({ queryKey: [...leadKeys.all, 'funnel'] })
      }
    }
    void run()
    const timer = setInterval(() => void run(), CHECK_EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hydrating, anySearched, checkChanges, queryClient])
}

