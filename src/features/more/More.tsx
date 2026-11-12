import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useAdmin } from '../../app/guards'
import { Button, Card, Page, Pill } from '../../components/ui'
import { DESIGNATION_LABELS, ROLE_LABELS } from '../../lib/labels'
import { formatPhone } from '../../lib/phone'
import { signOutHere } from '../auth/signOut'

/** More: who is signed in, Test mode (super admins), and Sign out. */
export function More() {
  const me = useAdmin()
  const qc = useQueryClient()
  return (
    <Page title="More">
      <Card className="flex flex-col gap-1">
        <p className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{me.name || 'No name yet'}</p>
        {me.phone && <p className="text-muted">+91 {formatPhone(me.phone)}</p>}
        <div>
          <Pill tone={me.adminRole === 'SUPER_ADMIN' ? 'brand' : 'muted'}>
            {me.designation ? `${ROLE_LABELS[me.adminRole]} · ${DESIGNATION_LABELS[me.designation]}` : ROLE_LABELS[me.adminRole]}
          </Pill>
        </div>
      </Card>
      {me.adminRole === 'SUPER_ADMIN' && (
        <Link
          to="/test-mode"
          className="flex min-h-12 items-center justify-between rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-raised"
        >
          <span>⚑ Test mode</span>
          <span aria-hidden>›</span>
        </Link>
      )}
      <Button
        variant="danger"
        onClick={() => signOutHere(qc)}
      >
        Sign out
      </Button>
      <p className="text-center text-xs text-muted">Clozest Admin 0.1.0</p>
    </Page>
  )
}
