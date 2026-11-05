import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { adminApi, keys, useTeam } from '../../api/admin'
import { explain, phoneError } from '../../api/errors'
import type { TeamMember } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Banner, Button, Card, EmptyState, ErrorState, Field, Loading, Page, Pill, Sheet } from '../../components/ui'
import { ROLE_LABELS } from '../../lib/labels'
import { formatPhone, normalizePhone } from '../../lib/phone'
import { dateIst } from '../../lib/time'

/** Team (super admin only): who can use this site; add an admin by phone, remove one. */
export function Team() {
  const me = useAdmin()
  const qc = useQueryClient()
  const team = useTeam()
  const sending = useRef(false)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  const normalized = normalizePhone(phone)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!normalized || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const member = await adminApi.addMember(normalized)
      setPhone('')
      setNotice(`+91 ${formatPhone(member.phone)} is an admin now. They sign in here with that number.`)
      await qc.invalidateQueries({ queryKey: keys.team })
    } catch (err) {
      setError(err)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Page title="Team">
      <form onSubmit={add} noValidate className="flex flex-col gap-3">
        <Field
          id="member-phone"
          label="Add an admin by mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="98480 12345"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="An account is made for the number if it has none. Their other sessions end; they sign in again."
          error={phoneError(error)}
        />
        <Button type="submit" busy={busy} disabled={!normalized}>
          Add to the team
        </Button>
      </form>
      {error !== null && !phoneError(error) && <Banner tone="bad">{explain(error)}</Banner>}
      {notice && <Banner tone="good">{notice}</Banner>}

      {team.isPending ? (
        <Loading />
      ) : team.isError && !team.data ? (
        <ErrorState message={explain(team.error)} onRetry={() => void team.refetch()} />
      ) : team.data.length === 0 ? (
        <EmptyState title="No one on the team yet" />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Team">
          {team.data.map((m) => (
            <li key={m.userId}>
              <Card className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    {m.name || 'No name yet'}
                    {m.userId === me.userId && <span className="text-muted"> (you)</span>}
                  </p>
                  <p className="text-sm text-muted">+91 {formatPhone(m.phone)}</p>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Pill tone={m.adminRole === 'SUPER_ADMIN' ? 'brand' : 'muted'}>{ROLE_LABELS[m.adminRole]}</Pill>
                    admin since {dateIst(m.since)}
                  </div>
                </div>
                {m.adminRole !== 'SUPER_ADMIN' && (
                  <Button variant="danger" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name || m.phone}`}>
                    Remove
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <RemoveMember
          member={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null)
            setNotice(`${removing.name || `+91 ${formatPhone(removing.phone)}`} is off the team and was signed out.`)
            void qc.invalidateQueries({ queryKey: keys.team })
          }}
          onRefused={() => void qc.invalidateQueries({ queryKey: keys.team })}
        />
      )}
    </Page>
  )
}

function RemoveMember({
  member,
  onClose,
  onDone,
  onRefused,
}: {
  member: TeamMember
  onClose: () => void
  onDone: () => void
  onRefused: () => void
}) {
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const who = member.name || `+91 ${formatPhone(member.phone)}`

  async function remove() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await adminApi.removeMember(member.userId)
      onDone()
    } catch (err) {
      setError(err)
      onRefused()
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`Remove ${who}?`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">They lose access to this site and are signed out at once.</p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" busy={busy} onClick={remove}>
            Remove
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
