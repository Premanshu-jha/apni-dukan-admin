import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { adminApi, keys, useCoverage, useTeam } from '../../api/admin'
import { ApiError, explain, fieldError, isApiError } from '../../api/errors'
import type { Designation, MemberIn, TeamMember } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { PincodeInput } from '../../components/PincodeInput'
import { Banner, Button, Chip, EmptyState, ErrorState, Field, Loading, Page } from '../../components/ui'
import { DESIGNATION_LABELS, DESIGNATIONS, ROLE_LABELS } from '../../lib/labels'
import { formatPhone, looksLikeEmail, normalizePhone } from '../../lib/phone'
import { isPincode, MAX_PINCODES } from '../../lib/pincodes'
import { signOutHere } from '../auth/signOut'

type Role = MemberIn['role']

/** /team/new: add a member. */
export function AddMember() {
  return <MemberForm member={null} />
}

/** /team/:id: edit anything about a member (their details, role, designation, pincodes). */
export function EditMember() {
  const { id = '' } = useParams()
  const team = useTeam()
  // Bumped by "Load the latest": the form starts again from what is saved now
  const [loads, setLoads] = useState(0)
  // The member the form was opened for: a background re-read that no longer lists them (removed meanwhile) keeps
  // the form and what was typed; Save then says they are off the team
  const [lastSeen, setLastSeen] = useState<TeamMember | null>(null)
  const listed = team.data?.find((m) => m.userId === id) ?? null
  if (listed && listed !== lastSeen) setLastSeen(listed) // adjust state while rendering
  if (team.isPending) {
    return (
      <Page title="Edit member" back="/team">
        <Loading />
      </Page>
    )
  }
  if (team.isError && !team.data) {
    return (
      <Page title="Edit member" back="/team">
        <ErrorState message={explain(team.error)} onRetry={() => void team.refetch()} />
      </Page>
    )
  }
  const member = listed ?? (lastSeen?.userId === id ? lastSeen : null)
  if (!member) {
    return (
      <Page title="Edit member" back="/team">
        <EmptyState title="Not on the team" body="They may have been removed meanwhile." action={<Link to="/team" className="text-link underline">Back to the team</Link>} />
      </Page>
    )
  }
  // Keyed by the member and the loads only: a background re-read never wipes what is being typed
  return (
    <MemberForm
      key={`${member.userId}:${loads}`}
      member={member}
      onLoadLatest={async () => {
        const r = await team.refetch()
        // Only a successful read starts the form again; a failed one keeps what was typed (the form says why)
        if (r.isError) return explain(r.error)
        setLoads((n) => n + 1)
        return null
      }}
    />
  )
}

/** Codes about one field, shown under it (the rest go in a banner). */
const PHONE_CODES: Record<string, string> = {
  ALREADY_ADMIN: 'This number is already on the team.',
  PHONE_IN_USE: 'Another Clozest account already uses this number.',
  TEST_PHONE: "This is a test number, or an account made in test mode, so it can't be on the team.",
  INVALID_PHONE: "That isn't a valid mobile number. Check the 10 digits.",
}
const EMAIL_CODES: Record<string, string> = {
  EMAIL_IN_USE: 'Another account already uses this email.',
  TEST_EMAIL: 'This is a test email. Remove it from the test emails first, or use another.',
  INVALID_EMAIL: 'Enter an email address, like name@gmail.com',
}
/** VALIDATION_FAILED details shown under their own field; any other detail goes in the banner. */
const FIELDS_WITH_A_PLACE = ['name', 'phone', 'email', 'pincodes']

function codeFor(e: unknown, codes: Record<string, string>): string | undefined {
  return e instanceof ApiError ? codes[e.code] : undefined
}

/**
 * The add or edit form. Everything typed stays when saving fails (offline, a refusal), so nothing has to be typed
 * again. For an Admin the designation and at least one pincode are needed; a Super admin has neither. A pincode typed
 * in the box but not yet added is added on Save (or, half typed, stops the save with a word).
 */
function MemberForm({ member, onLoadLatest }: { member: TeamMember | null; onLoadLatest?: () => Promise<string | null> }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useAdmin()
  const coverage = useCoverage()
  const sending = useRef(false)
  const [name, setName] = useState(member?.name ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState<Role>(member?.adminRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN')
  const [designation, setDesignation] = useState<Designation>(member?.designation ?? 'FIELD_AGENT')
  const [pincodes, setPincodes] = useState<string[]>(member?.pincodes ?? [])
  const [draft, setDraft] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The version this form was filled from: an edit is made on it, never on a newer one read in the background
  const [baseVersion] = useState(member?.version ?? 0)
  const self = member !== null && member.userId === me.userId

  // Others who cover each pincode (never this member)
  const coveredBy = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const c of coverage.data ?? []) {
      const others = c.agents.filter((a) => a.userId !== member?.userId).map((a) => a.name || `+91 ${a.phone ?? ''}`)
      if (others.length) out[c.pincode] = others
    }
    return out
  }, [coverage.data, member?.userId])

  const normalized = normalizePhone(phone)
  const admin = role === 'ADMIN'
  // Only a field agent covers pincodes; a support person answers tickets and has none
  const agent = admin && designation === 'FIELD_AGENT'
  // A complete pincode still in the box counts as added; a half-typed one must be finished or cleared
  const pending = agent && isPincode(draft) && !pincodes.includes(draft) ? [draft] : []
  const allPincodes = [...pincodes, ...pending]
  const local = {
    name: name.trim().length < 2 ? 'Enter their name (at least 2 letters).' : undefined,
    phone: normalized ? undefined : 'Enter a 10-digit mobile number.',
    email: looksLikeEmail(email) ? undefined : 'Enter an email address, like name@gmail.com',
    pincodes: !agent
      ? undefined
      : draft !== '' && !isPincode(draft)
        ? `Finish the pincode "${draft}" (6 digits) and tap Add, or clear it.`
        : allPincodes.length === 0
          ? 'Add at least one pincode.'
          : allPincodes.length > MAX_PINCODES
            ? `At most ${MAX_PINCODES} pincodes: clear the one in the box or remove one first.`
            : undefined,
  }
  const blocked = Object.values(local).some(Boolean)
  const show = (k: keyof typeof local) => (tried ? local[k] : undefined)
  const changedPhoneOrEmail =
    member !== null && (normalized !== member.phone || email.trim().toLowerCase() !== (member.email ?? '').toLowerCase())

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    if (blocked || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const body: MemberIn = {
      phone: normalized!,
      email: email.trim(),
      name: name.trim(),
      role,
      designation: admin ? designation : null,
      pincodes: agent ? allPincodes : [],
    }
    try {
      const saved = member ? await adminApi.editMember(member.userId, baseVersion, body) : await adminApi.addMember(body)
      void qc.invalidateQueries({ queryKey: keys.team })
      void qc.invalidateQueries({ queryKey: keys.coverage })
      void qc.invalidateQueries({ queryKey: keys.shops })
      void qc.invalidateQueries({ queryKey: keys.shopPages })
      void qc.invalidateQueries({ queryKey: keys.dashboard })
      if (self && changedPhoneOrEmail) {
        // Their own phone or email: the backend signed them out everywhere, this session included
        await signOutHere(qc)
        return
      }
      if (self) void qc.invalidateQueries({ queryKey: keys.me })   // their own role may have changed
      // Replaces the form in the history: Back from Team never reopens a form that was just saved
      navigate('/team', {
        replace: true,
        state: {
          notice: member
            ? `Saved ${saved.name ?? 'the member'}.${changedPhoneOrEmail ? ' They were signed out and confirm the new details at their next sign-in.' : ''}`
            : `${saved.name ?? 'They'} can sign in now with +91 ${formatPhone(saved.phone)}.${saved.emailVerified ? '' : ' They confirm their email at the first sign-in.'}`,
        },
      })
    } catch (err) {
      setError(err)
      if (isApiError(err, 'MEMBER_CHANGED')) void qc.invalidateQueries({ queryKey: keys.coverage })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  async function loadLatest() {
    if (!onLoadLatest || loading) return
    setLoading(true)
    setLoadError(null)
    const problem = await onLoadLatest()
    // On success this form is replaced by a new one; on failure it stays, with what was typed
    if (problem) {
      setLoadError(problem)
      setLoading(false)
    }
  }

  const phoneErr = show('phone') ?? codeFor(error, PHONE_CODES) ?? fieldError(error, 'phone')
  const emailErr = show('email') ?? codeFor(error, EMAIL_CODES) ?? fieldError(error, 'email')
  const nameErr = show('name') ?? fieldError(error, 'name')
  const pincodeErr = show('pincodes') ?? fieldError(error, 'pincodes')
  // Shown under a field only when that field is on screen; anything else (designation, role, …) in the banner
  const detailKeys = error instanceof ApiError && error.code === 'VALIDATION_FAILED' ? Object.keys(error.details) : []
  const onFields =
    Boolean(codeFor(error, PHONE_CODES) || codeFor(error, EMAIL_CODES)) ||
    (detailKeys.length > 0 && detailKeys.every((k) => FIELDS_WITH_A_PLACE.includes(k) && (k !== 'pincodes' || agent)))

  return (
    <Page title={member ? `Edit ${member.name || 'member'}` : 'Add a member'} back="/team">
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        {self && <Banner tone="warn">This is you. Changing your own phone or email signs you out here; changing your role takes effect at once.</Banner>}
        {isApiError(error, 'MEMBER_CHANGED') && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            <p>Someone changed this member after you opened it. Load the latest and make your change again.</p>
            {loadError && <p>Couldn't load it: {loadError}</p>}
            {onLoadLatest && (
              <Button variant="secondary" busy={loading} onClick={() => void loadLatest()}>
                Load the latest
              </Button>
            )}
          </div>
        )}
        {member && isApiError(error, 'NOT_FOUND') && (
          <Banner tone="bad">They're no longer on the team (another super admin removed them). Nothing was saved.</Banner>
        )}
        {error !== null && !onFields && !isApiError(error, 'MEMBER_CHANGED') && !(member && isApiError(error, 'NOT_FOUND')) && (
          <Banner tone="bad">{explain(error)}</Banner>
        )}
        <Field id="member-name" label="Name" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} error={nameErr} />
        <Field
          id="member-phone"
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="98480 12345"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="No code is sent now: they sign in with this number's code."
          error={phoneErr}
        />
        <Field
          id="member-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="They confirm it with a code at their next sign-in."
          error={emailErr}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted">Role</legend>
          <div className="flex gap-2">
            {(['ADMIN', 'SUPER_ADMIN'] as Role[]).map((r) => (
              <Chip key={r} selected={role === r} onClick={() => setRole(r)}>
                {ROLE_LABELS[r]}
              </Chip>
            ))}
          </div>
          <p className="text-sm text-muted">
            {!admin
              ? 'Sees everything and runs the team, assignments, support tickets and test mode.'
              : agent
                ? 'Visits and decides only the businesses assigned to them.'
                : 'Answers only the support tickets given to them. Sees no businesses.'}
          </p>
        </fieldset>
        {admin && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-muted">Designation</legend>
              <div className="flex gap-2">
                {DESIGNATIONS.map((d) => (
                  <Chip key={d} selected={designation === d} onClick={() => setDesignation(d)}>
                    {DESIGNATION_LABELS[d]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            {agent && (
            <PincodeInput
              id="member-pincodes"
              value={pincodes}
              onChange={setPincodes}
              draft={draft}
              onDraft={setDraft}
              coveredBy={coveredBy}
              error={pincodeErr}
            />
            )}
          </>
        )}
        {member && member.designation === 'FIELD_AGENT' && !agent && member.pendingVisits > 0 && (
          <Banner tone="warn">
            Their {member.pendingVisits} waiting {member.pendingVisits === 1 ? 'visit goes' : 'visits go'} to other field agents covering those pincodes, or
            to Unassigned.
          </Banner>
        )}
        {member && member.designation === 'FIELD_AGENT' && admin && designation === 'SUPPORT' && member.pincodes.length > 0 && (
          <Banner tone="warn">
            A support person covers no pincodes: their {member.pincodes.length} {member.pincodes.length === 1 ? 'pincode is' : 'pincodes are'} removed when you save.
          </Banner>
        )}
        {member && member.designation === 'SUPPORT' && !(admin && designation === 'SUPPORT') && member.openTickets > 0 && (
          <Banner tone="warn">
            Their {member.openTickets} open {member.openTickets === 1 ? 'ticket goes' : 'tickets go'} to the other support people, or to Unassigned.
          </Banner>
        )}
        <Button type="submit" busy={busy}>
          {member ? 'Save' : 'Add to the team'}
        </Button>
      </form>
    </Page>
  )
}
