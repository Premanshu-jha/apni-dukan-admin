import { useRef, useState } from 'react'
import { adminApi, useTeam } from '../../api/admin'
import { explain, isApiError } from '../../api/errors'
import type { AdminShop, TeamMember } from '../../api/types'
import { Banner, Button, Chip, ErrorState, Loading, Sheet } from '../../components/ui'
import { formatPhone } from '../../lib/phone'

/**
 * A super admin gives a business waiting for a visit to a field agent (or another one). Agents covering its pincode
 * come first; any field agent can be chosen (someone may be sent outside their area).
 */
export function AssignSheet({
  shop,
  onClose,
  onDone,
  onRefused,
}: {
  shop: AdminShop
  onClose: () => void
  onDone: (name: string) => void
  /** The shop or the team may have changed: re-read them (WRONG_STATUS also closes the sheet). */
  onRefused: (error: unknown) => void
}) {
  const team = useTeam()
  const sending = useRef(false)
  const [to, setTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const agents = (team.data ?? []).filter((m) => m.adminRole === 'ADMIN' && m.userId !== shop.assignedTo?.id)
  const covering = agents.filter((a) => a.pincodes.includes(shop.pincode))
  const others = agents.filter((a) => !a.pincodes.includes(shop.pincode))
  const label = (a: TeamMember) => a.name || `+91 ${formatPhone(a.phone)}`

  async function assign() {
    const target = agents.find((a) => a.userId === to)
    if (!target || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await adminApi.assign(shop.id, target.userId)
      onDone(label(target))
    } catch (err) {
      setError(err)
      if (isApiError(err, 'NOT_A_FIELD_AGENT')) {
        setTo(null)
        void team.refetch()   // they left the team meanwhile: the list loses them
      }
      onRefused(err)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const group = (title: string, list: TeamMember[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted">{title}</p>
        {list.map((a) => (
          <Chip key={a.userId} selected={to === a.userId} onClick={() => setTo(a.userId)}>
            {label(a)} · {a.pendingVisits} waiting
          </Chip>
        ))}
      </div>
    )

  return (
    <Sheet open title={`Who visits #${shop.shopCode} ${shop.name}?`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        {team.isPending ? (
          <Loading />
        ) : team.isError && !team.data ? (
          <ErrorState message={explain(team.error)} onRetry={() => void team.refetch()} />
        ) : agents.length === 0 ? (
          <p className="text-muted">There's no other field agent. Add one on the Team page first.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-4 overflow-y-auto" role="group" aria-label="Field agent">
            {group(`Covering ${shop.pincode}`, covering)}
            {group('Other field agents', others)}
          </div>
        )}
        {error !== null && (
          <Banner tone="bad">
            {isApiError(error, 'OWN_SHOP') ? 'That field agent works in this business, so they can\'t visit it. Choose someone else.' : explain(error)}
          </Banner>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" busy={busy} disabled={!agents.some((a) => a.userId === to)} onClick={assign}>
            Assign
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
