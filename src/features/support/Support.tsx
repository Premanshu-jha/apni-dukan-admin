import { useRef, useState } from 'react'
import { adminApi } from '../../api/admin'
import { ADMIN_MESSAGES, explain, fieldError, isApiError, phoneError } from '../../api/errors'
import type { Strike, StrikeLookup } from '../../api/types'
import { Banner, Button, Card, Field, Page, Pill, Sheet, TextArea } from '../../components/ui'
import { STRIKE_LABELS } from '../../lib/labels'
import { formatPhone, normalizePhone } from '../../lib/phone'
import { checkStrikeReason, clean, codePoints, REASON_MAX } from '../../lib/rules'
import { dateTimeIst } from '../../lib/time'

/** Support: look up a customer's no-show and late-cancel strikes by phone, and remove one with a reason. */
export function Support() {
  const [phone, setPhone] = useState('')
  const [found, setFound] = useState<{ phone: string; result: StrikeLookup } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Strike | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const looking = useRef(false)
  const normalized = normalizePhone(phone)

  /** One lookup at a time: a double tap (or Enter and a tap) sends one. */
  async function lookup(number: string) {
    if (looking.current) return
    looking.current = true
    setBusy(true)
    setError(null)
    try {
      setFound({ phone: number, result: await adminApi.lookupStrikes(number) })
    } catch (err) {
      setFound(null)
      setError(err)
    } finally {
      looking.current = false
      setBusy(false)
    }
  }

  return (
    <Page title="Support">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setNotice(null)
          if (normalized && !busy) void lookup(normalized)
        }}
      >
        <Field
          id="customer-phone"
          label="Customer's mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="98480 12345"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="See their no-show and late-cancel strikes."
          error={phoneError(error)}
        />
        <Button type="submit" busy={busy} disabled={!normalized}>
          Look up
        </Button>
      </form>
      {error !== null && !phoneError(error) && (
        <Banner tone={isApiError(error, 'CUSTOMER_NOT_FOUND') ? 'warn' : 'bad'}>{explain(error)}</Banner>
      )}
      {notice && <Banner tone="good">{notice}</Banner>}
      {found && (
        <section aria-labelledby="strikes" className="flex flex-col gap-2">
          <h2 id="strikes" className="font-semibold">
            +91 {formatPhone(found.phone)}
          </h2>
          {found.result.blockedUntil && new Date(found.result.blockedUntil).getTime() > Date.now() ? (
            <Banner tone="bad">Can't book until {dateTimeIst(found.result.blockedUntil)}</Banner>
          ) : (
            <p className="text-sm text-muted">Not blocked from booking.</p>
          )}
          {found.result.strikes.length === 0 ? (
            <p className="text-muted">No strikes.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Strikes">
              {found.result.strikes.map((s) => (
                <li key={s.appointmentId}>
                  <Card className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <div className="flex items-center gap-2">
                        <Pill tone="bad">{STRIKE_LABELS[s.kind] ?? s.kind}</Pill>
                        <span className="font-semibold">{s.bookingNo}</span>
                      </div>
                      <span className="[overflow-wrap:anywhere]">{s.salonName}</span>
                      <span className="text-muted">{dateTimeIst(s.struckAt)}</span>
                    </div>
                    <Button variant="secondary" onClick={() => setRemoving(s)} aria-label={`Remove strike ${s.bookingNo}`}>
                      Remove
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {removing && found && (
        <RemoveStrike
          strike={removing}
          onClose={() => setRemoving(null)}
          onDone={async () => {
            setRemoving(null)
            setNotice(`Strike ${removing.bookingNo} removed.`)
            await lookup(found.phone)
          }}
          onGone={async () => {
            // Removed by someone else meanwhile: show what is left.
            setRemoving(null)
            await lookup(found.phone)
            setNotice(ADMIN_MESSAGES.STRIKE_NOT_FOUND)
          }}
        />
      )}
    </Page>
  )
}

function RemoveStrike({
  strike,
  onClose,
  onDone,
  onGone,
}: {
  strike: Strike
  onClose: () => void
  onDone: () => void
  onGone: () => void
}) {
  const sending = useRef(false)
  const [reason, setReason] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const problem = checkStrikeReason(reason)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setShown(true)
    if (problem || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await adminApi.removeStrike(strike.appointmentId, clean(reason))
      onDone()
    } catch (err) {
      if (isApiError(err, 'STRIKE_NOT_FOUND')) onGone()
      else setError(err)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open title={`Remove strike ${strike.bookingNo}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {STRIKE_LABELS[strike.kind]} at {strike.salonName}, {dateTimeIst(strike.struckAt)}.
        </p>
        <TextArea
          id="strike-reason"
          label="Why remove it"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={`Kept with the strike. ${codePoints(clean(reason))}/${REASON_MAX}`}
          error={(shown && problem) || fieldError(error, 'reason')}
        />
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" className="flex-1" busy={busy}>
            Remove strike
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
