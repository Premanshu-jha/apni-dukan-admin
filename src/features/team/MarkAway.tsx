import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi, keys } from '../../api/admin'
import { explain } from '../../api/errors'
import type { TeamMember } from '../../api/types'
import { Banner, Button, Sheet } from '../../components/ui'
import { formatPhone } from '../../lib/phone'

/**
 * Marking a support person away (leave, sick): says what happens, then does it on a second tap. Their open tickets
 * go to the others by the rule; nothing new comes to them until they are back.
 */
export function MarkAway({
  member,
  self,
  onClose,
  onDone,
}: {
  member: Pick<TeamMember, 'userId' | 'name' | 'phone'> & { openTickets?: number | null }
  self: boolean
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const who = self ? 'you' : member.name || `+91 ${formatPhone(member.phone)}`
  async function go() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await adminApi.setAway(member.userId, true)
      // Closes once the lists say so: the button never shows "Mark away" again in between
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }), qc.invalidateQueries({ queryKey: keys.team })])
      const moved = r.moved > 0 ? ` ${r.moved} open ${r.moved === 1 ? 'ticket went' : 'tickets went'} to the other support people.` : ''
      const stayed = r.stayed > 0 ? ` ${r.stayed} stayed: nobody else could take ${r.stayed === 1 ? 'it' : 'them'} (their own question, or nobody else here).` : ''
      onDone(`${self ? "You're" : `${who} is`} away: no new tickets ${self ? 'come to you' : 'go to them'}.${moved}${stayed}`)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }
  return (
    <Sheet open title={self ? 'Mark yourself away?' : `Mark ${who} away?`} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          For leave or a sick day. {self ? 'Your' : 'Their'} open tickets go to the other support people, and no new tickets
          come to {self ? 'you' : 'them'} until {self ? "you tap \"I'm back\"" : 'they are back'}. A reply to one of{' '}
          {self ? 'your' : 'their'} old tickets goes to someone here too.
        </p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <Button busy={busy} onClick={() => void go()}>
          Yes, mark {self ? 'me' : 'them'} away
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
