import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { adminApi, keys, useTestMode } from '../../api/admin'
import { explain, fieldError, phoneError } from '../../api/errors'
import type { TestModeState } from '../../api/types'
import { Banner, Button, Card, ErrorState, Field, Loading, Page, Pill } from '../../components/ui'
import { formatPhone, normalizePhone } from '../../lib/phone'
import { checkTestPhone, clean, HOURS_MAX, HOURS_MIN, LABEL_MAX, validHours } from '../../lib/rules'
import { dateIst, testModeActive, untilLabel } from '../../lib/time'
import { useNow } from '../../lib/useNow'

const HOURS = Array.from({ length: HOURS_MAX - HOURS_MIN + 1 }, (_, i) => i + HOURS_MIN)

/** OTP test mode (super admin only): the test numbers, and switching it on for 1–8 hours or off. */
export function TestMode() {
  const qc = useQueryClient()
  const state = useTestMode()
  const now = useNow(15_000)
  const sending = useRef(false)
  const [hours, setHours] = useState(2)
  const [phone, setPhone] = useState('')
  const [label, setLabel] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Runs one change; the answer is the new state. The banner on every screen follows (/admin/me). */
  async function run(what: string, call: () => Promise<TestModeState>, done: string, after?: () => void) {
    if (sending.current) return
    sending.current = true
    setBusy(what)
    setError(null)
    setNotice(null)
    try {
      qc.setQueryData(keys.testMode, await call())
      setNotice(done)
      after?.()
    } catch (err) {
      setError(err)
    } finally {
      sending.current = false
      setBusy(null)
      void qc.invalidateQueries({ queryKey: keys.me })
    }
  }

  if (state.isPending) return <Page title="Test mode"><Loading /></Page>
  if (state.isError && !state.data) {
    return (
      <Page title="Test mode">
        <ErrorState message={explain(state.error)} onRetry={() => void state.refetch()} />
      </Page>
    )
  }

  const s = state.data
  const on = testModeActive(s, now)
  const phoneErrors = checkTestPhone(phone, label)

  return (
    <Page title="Test mode">
      <Banner tone="warn">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>Only numbers nobody has signed in with can be added as test numbers.</li>
          <li>
            While test mode is on, a test number signs in with <strong>any 6-digit code</strong> (no SMS is sent).
          </li>
          <li>Email codes are always real, for test numbers too.</li>
          <li>Test accounts are signed out when test mode ends or is switched off, or when their number is removed.</li>
        </ul>
      </Banner>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-semibold">{on ? 'On' : 'Off'}</p>
          <Pill tone={on ? 'bad' : 'muted'}>{on ? 'Test numbers skip the code' : 'Normal sign-in'}</Pill>
        </div>
        {on && (
          <p className="text-sm text-muted">
            {s.until ? `Until ${untilLabel(s.until, now)}` : 'No end time'}
            {s.turnedOnByName ? `, switched on by ${s.turnedOnByName}` : ''}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="hours" className="text-sm font-medium text-muted">
            {on ? 'Change the end to' : 'Switch on for'}
          </label>
          <select
            id="hours"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? '1 hour' : `${h} hours`} from now
              </option>
            ))}
          </select>
        </div>
        <Button
          variant={on ? 'secondary' : 'danger'}
          busy={busy === 'on'}
          disabled={busy !== null || !validHours(hours)}
          onClick={() =>
            run('on', () => adminApi.testModeOn(hours), `Test mode is on for ${hours === 1 ? '1 hour' : `${hours} hours`}.`)
          }
        >
          {on ? `Keep on for ${hours === 1 ? '1 hour' : `${hours} hours`} from now` : `Switch on for ${hours === 1 ? '1 hour' : `${hours} hours`}`}
        </Button>
        {on && (
          <Button busy={busy === 'off'} disabled={busy !== null} onClick={() => run('off', adminApi.testModeOff, 'Test mode is off.')}>
            Switch off now
          </Button>
        )}
      </Card>

      {error !== null && !phoneError(error) && <Banner tone="bad">{explain(error)}</Banner>}
      {notice && <Banner tone="good">{notice}</Banner>}

      <section aria-labelledby="test-numbers" className="flex flex-col gap-2">
        <h2 id="test-numbers" className="font-semibold">Test numbers</h2>
        {s.phones.length === 0 ? (
          <p className="text-sm text-muted">No test numbers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Test numbers">
            {s.phones.map((p) => (
              <li key={p.phone}>
                <Card className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-semibold">+91 {formatPhone(p.phone)}</p>
                    <p className="text-sm [overflow-wrap:anywhere]">{p.label}</p>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Pill tone={p.hasAccount ? 'good' : 'muted'}>{p.hasAccount ? 'Has an account' : 'No account yet'}</Pill>
                      added {dateIst(p.addedAt)}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    aria-label={`Remove test number ${formatPhone(p.phone)}`}
                    busy={busy === `rm-${p.phone}`}
                    disabled={busy !== null}
                    onClick={() => run(`rm-${p.phone}`, () => adminApi.removeTestPhone(p.phone), `+91 ${formatPhone(p.phone)} is no longer a test number; its test account was signed out.`)}
                  >
                    Remove
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setShown(true)
            const n = normalizePhone(phone)
            if (!n || phoneErrors.label) return
            void run('add', () => adminApi.addTestPhone(n, clean(label)), `+91 ${formatPhone(n)} is a test number now.`, () => {
              setPhone('')
              setLabel('')
              setShown(false)
            })
          }}
        >
          <Field
            id="test-phone"
            label="Test number"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="98480 12345"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={(shown && phoneErrors.phone) || phoneError(error)}
          />
          <Field
            id="test-label"
            label="Whose number"
            placeholder="Play Store review"
            hint={`2 to ${LABEL_MAX} characters`}
            maxLength={LABEL_MAX + 10}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            error={(shown && phoneErrors.label) || fieldError(error, 'label')}
          />
          <Button type="submit" variant="secondary" busy={busy === 'add'} disabled={busy !== null}>
            Add test number
          </Button>
        </form>
      </section>
    </Page>
  )
}
