import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { refreshSession } from '../../api/client'
import { Banner, Button, Page } from '../../components/ui'
import { formatPhone } from '../../lib/phone'
import { isTeam, roleOf } from '../../lib/roles'
import { useSession } from '../../store/session'
import { Brand } from './Brand'
import { signOutHere } from './signOut'

/**
 * Signed in, but not on the team (or no longer): nothing here for them. "Check again" fetches a fresh sign-in, for
 * someone the super admin has just added.
 */
export function NotTeam({ onRecheck }: { onRecheck?: () => void }) {
  const qc = useQueryClient()
  const phone = useSession((s) => s.user?.phone)
  const [busy, setBusy] = useState<'check' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function checkAgain() {
    setBusy('check')
    setNotice(null)
    const ok = await refreshSession()
    setBusy(null)
    if (!ok) return
    if (!isTeam(roleOf(useSession.getState().user))) setNotice('This number is still not on the team.')
    else onRecheck?.()
  }

  return (
    <Page>
      <Brand />
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-xl font-semibold">This is for the Clozest team</h1>
        <p className="text-muted">
          {phone ? <>You're signed in as +91 {formatPhone(phone)}, which isn't on the team. </> : null}
          Shop owners use the partner app, customers the Clozest app. If you should be on the team, ask the super
          admin to add your number.
        </p>
      </div>
      {notice && <Banner tone="warn">{notice}</Banner>}
      <Button variant="secondary" busy={busy === 'check'} disabled={busy !== null} onClick={checkAgain}>
        Check again
      </Button>
      <Button
        variant="danger"
        disabled={busy !== null}
        onClick={() => signOutHere(qc)}
      >
        Sign out
      </Button>
    </Page>
  )
}
