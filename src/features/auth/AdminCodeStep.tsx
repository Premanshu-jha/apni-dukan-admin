import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { authApi } from '../../api/auth'
import { ApiError, messageOf } from '../../api/errors'
import { CodeInput } from '../../components/CodeInput'
import { Banner, Button, Page } from '../../components/ui'
import { useSession } from '../../store/session'
import { nextAfterSignIn } from './flow'

/** "r***@gmail.com": enough to recognise your own inbox, not enough to read someone's address off a screen. */
export function maskEmail(address: string): string {
  const at = address.indexOf('@')
  return at <= 1 ? `***${address.slice(Math.max(at, 0))}` : `${address[0]}***${address.slice(at)}`
}

/**
 * The admin email step: after the phone code, a code sent to the admin's verified email opens the admin pages on
 * this browser for 12 hours. Someone who has only the phone (a stolen phone, a copied SIM) can't get past it.
 * The code is sent as soon as the screen opens; "Send again" after 30 seconds.
 */
export function AdminCodeStep() {
  const navigate = useNavigate()
  const grantAdmin = useSession((s) => s.grantAdmin)
  const setUser = useSession((s) => s.setUser)
  const user = useSession((s) => s.user)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Sending a code, and checking one: apart, so a code typed while the email is still on its way is checked */
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [wait, setWait] = useState(0)
  const asked = useRef(false)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function send() {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      await authApi.sendAdminCode()
      setSent(true)
      setWait(30)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_REQUIRED' && user) {
        // The email isn't verified any more (changed elsewhere): confirm it first, this step comes back after
        setUser({ ...user, emailVerified: false })
        navigate('/welcome/email', { replace: true })
        return
      }
      setError(messageOf(err))
    } finally {
      setSending(false)
    }
  }

  // Send once when the screen opens (not again on a re-render)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void send()
  }, [])

  async function verify(value: string) {
    if (value.length !== 6 || checking) return
    setChecking(true)
    setError(null)
    try {
      const access = await authApi.verifyAdminCode(value)
      grantAdmin(access.accessToken, access.user)
      navigate(nextAfterSignIn(access.user), { replace: true })
    } catch (err) {
      setError(messageOf(err))
      setCode('')
    } finally {
      setChecking(false)
    }
  }

  const to = user?.email ? maskEmail(user.email) : 'your email'
  return (
    <Page title="Check your email">
      <p className="text-muted">
        For the team's safety, the admin pages need a second code each time you sign in on a device, and again every 12
        hours.{' '}
        {sent ? (
          <>
            We sent it to <span className="text-ink">{to}</span>. Check spam if you don't see it.
          </>
        ) : (
          <>
            Sending it to <span className="text-ink">{to}</span>…
          </>
        )}
      </p>
      <div className="flex flex-col gap-4">
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
          {wait > 0 ? `Send again in ${wait} s` : 'Send again'}
        </Button>
        <p className="text-sm text-muted">
          Didn't ask for this? Someone may have your phone's sign-in codes. Don't share this code, and tell the super
          admin.
        </p>
      </div>
    </Page>
  )
}
