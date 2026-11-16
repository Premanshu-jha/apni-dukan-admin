import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi, keys } from '../../api/admin'
import { explain, isApiError } from '../../api/errors'
import type { SalonSubscription } from '../../api/types'
import { Banner, Button, Card } from '../../components/ui'
import { dateIst } from '../../lib/time'

/** The last day to pay: hiddenFrom is the midnight (India time) starting the day after. */
function payBy(s: SalonSubscription): string {
  return dateIst(new Date(Date.parse(s.hiddenFrom!) - 1).toISOString())
}

function stateText(s: SalonSubscription): string {
  switch (s.state) {
    case 'NONE':
      return 'Not started (starts at its first approval)'
    case 'AUTOPAY':
      return 'AutoPay on'
    case 'TRIAL':
      return 'Free trial'
    case 'PAID':
      return 'Paid (AutoPay off)'
    case 'GRACE':
      return `Not paid: ${s.enforced ? 'hidden' : 'would be hidden'} after ${payBy(s)}`
    case 'HIDDEN':
      return s.enforced ? 'Not paid: hidden from customers' : 'Not paid (hiding not switched on yet)'
  }
}

/** Razorpay's status in words. */
const RAZORPAY: Record<string, string> = {
  CREATED: 'payment screen opened, not approved',
  AUTHENTICATED: 'AutoPay approved, first charge to come',
  ACTIVE: 'AutoPay running',
  PENDING: 'last AutoPay charge failed, Razorpay retrying',
  HALTED: 'AutoPay stopped after failed charges',
  CANCELLED: 'AutoPay cancelled',
  COMPLETED: 'finished',
  EXPIRED: 'expired',
  PAUSED: 'paused',
}

/**
 * A salon's subscription on its page: its state and dates. A super admin can end a test salon's trial (its owner
 * signed in with an OTP test number), so Razorpay's reviewer lands on the payment screen.
 */
export function SubscriptionSection({ shopId, superAdmin }: { shopId: string; superAdmin: boolean }) {
  const qc = useQueryClient()
  const sub = useQuery({ queryKey: keys.subscription(shopId), queryFn: () => adminApi.subscription(shopId) })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  async function endTrial() {
    if (!window.confirm('End this test salon’s free trial now? Its owner (the test number) will see the payment screen.')) return
    setBusy(true)
    setMessage(null)
    try {
      const after = await adminApi.endTestTrial(shopId)
      qc.setQueryData(keys.subscription(shopId), after)
      setMessage(
        after.state === 'GRACE' || after.state === 'HIDDEN'
          ? { tone: 'good', text: 'Trial ended: the test number now sees the payment screen.' }
          : { tone: 'bad', text: `Trial ended, but it is ${stateText(after).toLowerCase()}: nothing to pay yet.` },
      )
    } catch (e) {
      setMessage({
        tone: 'bad',
        text: isApiError(e, 'NOT_A_TEST_SALON')
          ? 'Only a test salon’s trial can be ended (its owner signed in with an OTP test number).'
          : explain(e),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="subscription" className="flex flex-col gap-2">
      <h2 id="subscription" className="font-semibold">Subscription</h2>
      {sub.isPending ? (
        <Card className="text-sm text-muted">Loading…</Card>
      ) : sub.isError ? (
        <Card className="flex flex-col gap-2 text-sm">
          <p className="text-muted">Couldn't load the subscription: {explain(sub.error)}</p>
          <Button variant="secondary" busy={sub.isFetching} onClick={() => void sub.refetch()}>
            Try again
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {stateText(sub.data)} · ₹{sub.data.pricePerMonth} a month
          </p>
          {sub.data.autoPayFailed && <p className="text-bad">The last AutoPay payment didn't go through.</p>}
          {sub.data.trialEndsAt && <p className="text-muted">Free trial until {dateIst(sub.data.trialEndsAt)}</p>}
          {sub.data.paidUntil && <p className="text-muted">Paid until {dateIst(sub.data.paidUntil)}</p>}
          {sub.data.razorpayStatus && (
            <p className="text-muted">Razorpay: {RAZORPAY[sub.data.razorpayStatus] ?? sub.data.razorpayStatus.toLowerCase()}</p>
          )}
          {message && <Banner tone={message.tone}>{message.text}</Banner>}
          {superAdmin && sub.data.testSalon && sub.data.state === 'TRIAL' && (
            <Button variant="secondary" busy={busy} onClick={() => void endTrial()}>
              End trial now (test salon)
            </Button>
          )}
        </Card>
      )}
    </section>
  )
}
