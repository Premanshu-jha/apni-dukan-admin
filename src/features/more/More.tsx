import { useQueryClient } from '@tanstack/react-query'
import { useAdmin } from '../../app/guards'
import { Button, Card, Page, Pill } from '../../components/ui'
import { ROLE_LABELS } from '../../lib/labels'
import { formatPhone } from '../../lib/phone'
import { signOutHere } from '../auth/signOut'

/** More: who is signed in, and Sign out. */
export function More() {
  const me = useAdmin()
  const qc = useQueryClient()
  return (
    <Page title="More">
      <Card className="flex flex-col gap-1">
        <p className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{me.name || 'No name yet'}</p>
        {me.phone && <p className="text-muted">+91 {formatPhone(me.phone)}</p>}
        <div>
          <Pill tone={me.adminRole === 'SUPER_ADMIN' ? 'brand' : 'muted'}>{ROLE_LABELS[me.adminRole]}</Pill>
        </div>
      </Card>
      <Button
        variant="danger"
        onClick={() => signOutHere(qc)}
      >
        Sign out
      </Button>
      <p className="text-center text-xs text-muted">Apni Dukan Admin 0.1.0</p>
    </Page>
  )
}
