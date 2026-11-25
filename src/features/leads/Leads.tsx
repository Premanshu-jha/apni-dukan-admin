import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useDue, useFunnel, useMine } from '../../api/leads'
import { explain } from '../../api/errors'
import type { LeadDue } from '../../api/types'
import { useAdmin } from '../../app/guards'
import { Tabs } from '../../components/Tabs'
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Loading, Page, Pill, Switch } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { dateOnly } from '../../lib/time'
import { AreasTab } from './AreasTab'
import { LeadSheet } from './LeadSheet'
import { count, dueAsShop, LEAD_STATUS_LABELS } from './logic'
import { useLeads } from './store'

type View = 'areas' | 'due' | 'funnel'

/**
 * Leads: salons and beauty businesses found on the map, area by area, and the team's work on them. Three tabs (kept in
 * the address as ?view=): Areas (pick a district, search areas, see and work the list), Follow-ups (due today or
 * earlier), Funnel (super admins: how each area and person is doing).
 */
export function Leads() {
  const superAdmin = isSuperAdmin(useAdmin().adminRole)
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: View = raw === 'due' || (raw === 'funnel' && superAdmin) ? raw : 'areas'
  const due = useDue(false)
  const dueCount = due.data?.length ?? 0
  const options: Array<{ value: View; label: string }> = [
    { value: 'areas', label: 'Areas' },
    { value: 'due', label: dueCount ? `Follow-ups (${dueCount})` : 'Follow-ups' },
    ...(superAdmin ? [{ value: 'funnel' as const, label: 'Funnel' }] : []),
  ]
  return (
    <Page title="Leads">
      <Tabs label="Leads view" value={view} options={options} onChange={(v) => setParams({ view: v }, { replace: true })} />
      {view === 'areas' && <AreasTab />}
      {view === 'due' && <DueTab />}
      {view === 'funnel' && superAdmin && <FunnelTab />}
    </Page>
  )
}

/**
 * Follow-ups due today or earlier, or all my leads (the ones given to me that were tried), from their saved details:
 * your own, or (super admins) everyone's.
 */
function DueTab() {
  const superAdmin = isSuperAdmin(useAdmin().adminRole)
  const leadSaved = useLeads((s) => s.leadSaved)
  const [everyone, setEveryone] = useState(false)
  const [show, setShow] = useState<'due' | 'mine'>('due')
  const dueQuery = useDue(superAdmin && everyone)
  const mineQuery = useMine(superAdmin && everyone, show === 'mine')
  const due = show === 'due' ? dueQuery : mineQuery
  const [editing, setEditing] = useState<LeadDue | null>(null)
  return (
    <section aria-labelledby="due-title" className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Chip selected={show === 'due'} onClick={() => setShow('due')}>
          Due today
        </Chip>
        <Chip selected={show === 'mine'} onClick={() => setShow('mine')}>
          {everyone ? 'All worked leads' : 'My leads'}
        </Chip>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 id="due-title" className="font-semibold">
          {show === 'due' ? 'Due today or earlier' : everyone ? 'Leads the team is working on' : 'Leads given to you'}
        </h2>
        {superAdmin && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Everyone's
            <Switch label="Show everyone's follow-ups" checked={everyone} onChange={setEveryone} />
          </label>
        )}
      </div>
      {due.isPending ? (
        <Loading />
      ) : due.isError && !due.data ? (
        <ErrorState message={explain(due.error)} onRetry={() => void due.refetch()} />
      ) : due.data.length === 0 ? (
        show === 'due' ? (
          <EmptyState
            title="Nothing due"
            body="When you set a call-back date on a lead, it shows here on that day. Set one from the lead's Update button."
          />
        ) : (
          <EmptyState
            title="No leads yet"
            body="Leads given to you show here once someone tried them (called, visited, no answer). Find businesses in Areas and press Update."
          />
        )
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Follow-ups due">
          {due.data.map((d) => (
            <li key={d.mapboxId}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{d.name || 'A lead (not contacted yet)'}</p>
                  {d.followUpOn && (
                    <Pill tone={d.followUpOn < todayIso() ? 'bad' : d.followUpOn === todayIso() ? 'warn' : 'muted'}>
                      {d.followUpOn < todayIso() ? `Was due ${dateOnly(d.followUpOn)}` : d.followUpOn === todayIso() ? 'Due today' : `Call back ${dateOnly(d.followUpOn)}`}
                    </Pill>
                  )}
                  <Pill tone="muted">{LEAD_STATUS_LABELS[d.status]}</Pill>
                </div>
                <p className="text-sm text-muted [overflow-wrap:anywhere]">
                  {d.pincode} · {d.places}
                  {everyone && d.assignedTo ? ` · ${d.assignedTo.name ?? 'Someone who left'}` : ''}
                </p>
                {d.note && <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{d.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {d.phone && (
                    <a href={`tel:+91${d.phone}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 font-semibold text-link">
                      Call {d.phone}
                    </a>
                  )}
                  <Button variant="secondary" className="min-h-11" onClick={() => setEditing(d)}>
                    Update
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <LeadSheet
          mapboxId={editing.mapboxId}
          shop={dueAsShop(editing)}
          title={editing.name || 'Lead'}
          lead={{
            status: editing.status,
            note: editing.note,
            assignedTo: editing.assignedTo,
            followUpOn: editing.followUpOn,
            whatsappOk: editing.whatsappOk,
            whatsappOkAt: null,
            whatsappOkBy: null,
            signedUpAt: null,
            creditedTo: null,
            version: editing.version,
            updatedAt: null,
            updatedBy: null,
          }}
          onClose={() => setEditing(null)}
          onSaved={(lead) => {
            leadSaved(editing.mapboxId, lead)
            void due.refetch()
          }}
        />
      )}
    </section>
  )
}

/** Super admins: each area's and each person's numbers for one of the picked districts. */
function FunnelTab() {
  const districts = useLeads((s) => s.districts)
  const [index, setIndex] = useState(0)
  const d = districts[Math.min(index, districts.length - 1)]
  const funnel = useFunnel(d?.district ?? '', d?.state ?? '', !!d)
  if (!d) return <EmptyState title="Pick a district first" body="Open Areas and pick a city or district; its funnel shows here." />
  return (
    <section aria-labelledby="funnel-title" className="flex flex-col gap-3">
      <h2 id="funnel-title" className="font-semibold">
        Funnel
      </h2>
      {districts.length > 1 && (
        <label className="flex flex-col gap-2 text-sm text-muted">
          District
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink"
          >
            {districts.map((x, i) => (
              <option key={`${x.district}|${x.state}`} value={i}>
                {x.district}, {x.state}
              </option>
            ))}
          </select>
        </label>
      )}
      {funnel.isPending ? (
        <Loading />
      ) : funnel.isError ? (
        <ErrorState message={explain(funnel.error)} onRetry={() => void funnel.refetch()} />
      ) : funnel.data.areas.length === 0 ? (
        <EmptyState title="No leads worked here yet" body="Once the team contacts businesses in this district, the numbers show here." />
      ) : (
        <>
          <Banner>Leads saved → contacted → interested → signed up on Clozest, per area and per person.</Banner>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">Funnel per area</caption>
              <thead className="bg-raised text-left text-muted">
                <tr>
                  <th className="p-2">Area</th>
                  <th className="p-2 text-right">Saved</th>
                  <th className="p-2 text-right">Contacted</th>
                  <th className="p-2 text-right">Interested</th>
                  <th className="p-2 text-right">Not interested</th>
                  <th className="p-2 text-right">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {funnel.data.areas.map((a) => (
                  <tr key={a.pincode} className="border-t border-line">
                    <td className="p-2">
                      <span className="font-semibold">{a.pincode}</span> <span className="text-muted">{a.places}</span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{count(a.touched)}</td>
                    <td className="p-2 text-right tabular-nums">{count(a.contacted)}</td>
                    <td className="p-2 text-right tabular-nums">{count(a.interested)}</td>
                    <td className="p-2 text-right tabular-nums">{count(a.notInterested)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{count(a.signedUp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {funnel.data.people.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full text-sm">
                <caption className="sr-only">Funnel per person</caption>
                <thead className="bg-raised text-left text-muted">
                  <tr>
                    <th className="p-2">Person</th>
                    <th className="p-2 text-right">Assigned</th>
                    <th className="p-2 text-right">Contacted</th>
                    <th className="p-2 text-right">Interested</th>
                    <th className="p-2 text-right">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.data.people.map((p) => (
                    <tr key={p.person.id} className="border-t border-line">
                      <td className="p-2">{p.person.name ?? 'Someone who left the team'}</td>
                      <td className="p-2 text-right tabular-nums">{count(p.assigned)}</td>
                      <td className="p-2 text-right tabular-nums">{count(p.contacted)}</td>
                      <td className="p-2 text-right tabular-nums">{count(p.interested)}</td>
                      <td className="p-2 text-right font-semibold tabular-nums">{count(p.signedUp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Today in India (yyyy-MM-dd), as the backend counts follow-ups. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
