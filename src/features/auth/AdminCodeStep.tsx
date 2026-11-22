import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { authApi } from '../../api/auth'
import { ApiError, messageOf } from '../../api/errors'
import { CodeInput } from '../../components/CodeInput'
import { Banner, Button, Page } from '../../components/ui'
import { storage } from '../../lib/storage'
import { useSession } from '../../store/session'
import { nextAfterSignIn } from './flow'
import { signOutHere } from './signOut'

/** "r***@gmail.com": enough to recognise your own inbox, not enough to read someone's address off a screen. */
export function maskEmail(address: string): string {
  const at = address.indexOf('@')
  return at <= 1 ? `***${address.slice(Math.max(at, 0))}` : `${address[0]}***${address.slice(at)}`
}

/** When the last code was sent, per person: a reload or a second tab doesn't send a new one (which replaces it). */
const SENT_KEY = 'ada.adminCodeSent'
/** A code works 10 minutes; within them, opening the screen again doesn't send another. */
const CODE_LIFE_MS = 10 * 60_000
const RESEND_AFTER_S = 30

interface SentMark {
  userId: string
  at: number
}

/** When this person's last code was sent, if it still works (within 10 minutes); else null. */
export function lastSent(userId: string | undefined, now = Date.now()): number | null {
  const mark = storage.getJson<SentMark>(SENT_KEY)
  return mark && mark.userId === userId && now - mark.at < CODE_LIFE_MS ? mark.at : null
}

/**
 * The admin email step: after the phone code, a code sent to the admin's verified email opens the admin pages on
 * this browser for 12 hours. Someone who has only the phone (a stolen phone, a copied SIM) can't get past it.
 * The code is sent when the screen opens, unless one was sent in the last 10 minutes (a reload or another tab keeps
 * the code already in the inbox working); "Send again" after 30 seconds.
 */
export function AdminCodeStep() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const grantAdmin = useSession((s) => s.grantAdmin)
  const setUser = useSession((s) => s.setUser)
  const user = useSession((s) => s.user)
  const [code, setCode] = useState('')
  const [sentAt, setSentAt] = useState<number | null>(() => lastSent(user?.id))
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Sending a code, and checking one: apart, so a code typed while the email is still on its way is checked */
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [wait, setWait] = useState(() => {
    const at = lastSent(user?.id)
    return at ? Math.max(0, RESEND_AFTER_S - Math.floor((Date.now() - at) / 1000)) : 0
  })
  const asked = useRef(false)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  /** Taken off the team meanwhile: the screen for people not on the team takes over. */
  function notOnTheTeam() {
    if (user) setUser({ ...user, admin: false, adminRole: 'NONE', adminCodeNeeded: false })
  }

  async function send() {
    if (sending) return
    setSending(true)
    setSendError(null)
    setError(null)
    try {
      await authApi.sendAdminCode()
      const at = Date.now()
      if (user) storage.setJson(SENT_KEY, { userId: user.id, at } satisfies SentMark)
      setSentAt(at)
      setWait(RESEND_AFTER_S)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_REQUIRED' && user) {
        // The email isn't verified any more (changed by the team): confirm it first, this step comes back after
        setUser({ ...user, emailVerified: false })
        navigate('/welcome/email', { replace: true })
        return
      }
      if (err instanceof ApiError && err.code === 'NOT_AN_ADMIN') return notOnTheTeam()
      setSendError(messageOf(err))
      // Too many: wait as long as the backend says before trying again
      if (err instanceof ApiError && err.retryAfterSeconds) setWait(err.retryAfterSeconds)
    } finally {
      setSending(false)
    }
  }

  // Send once when the screen opens (not again on a re-render, nor within 10 minutes of the last one)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (lastSent(user?.id) === null) void send()
  }, [])

  async function verify(value: string) {
    if (value.length !== 6 || checking) return
    setChecking(true)
    setError(null)
    try {
      const access = await authApi.verifyAdminCode(value)
      storage.remove(SENT_KEY)
      grantAdmin(access.accessToken, access.user)
      navigate(nextAfterSignIn(access.user), { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_AN_ADMIN') return notOnTheTeam()
      setError(messageOf(err))
      setCode('')
    } finally {
      setChecking(false)
    }
  }

  const to = user?.email ? maskEmail(user.email) : 'your email'
  const time = sentAt ? new Date(sentAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <Page title="Check your email">
      <p className="text-muted">
        For the team's safety, the admin pages need a second code each time you sign in on a device, and again every 12
        hours.
      </p>
      <p className="text-muted">
        {sentAt ? (
          <>
            We sent it to <span className="text-ink">{to}</span> at {time}. Check spam if you don't see it.
          </>
        ) : sending ? (
          <>
            Sending it to <span className="text-ink">{to}</span>…
          </>
        ) : (
          <>
            It goes to <span className="text-ink">{to}</span>.
          </>
        )}
      </p>
      <div className="flex flex-col gap-4">
        {sendError && <Banner tone="bad">We couldn't send the code. {sendError}</Banner>}
        <CodeInput
          id="admin-code"
          label="Code from your email"
          value={code}
          onChange={(v) => {
            setCode(v)
            if (v.length === 6) void verify(v)
          }}
        />
        {error && <Banner tone="bad">{error}</Banner>}
        <Button busy={checking} disabled={code.length !== 6} onClick={() => verify(code)}>
          Verify
        </Button>
        <Button variant="ghost" onClick={() => send()} disabled={sending || wait > 0}>
          {wait > 0 ? `Send again in ${wait} s` : sentAt || sendError ? 'Send again' : 'Send the code'}
        </Button>
        <p className="text-sm text-muted">
          Can't open this email, or not you? Ask the super admin to check the email on the Team page.
        </p>
        <Button variant="ghost" onClick={() => signOutHere(qc)}>
          Sign out
        </Button>
      </div>
    </Page>
  )
}
