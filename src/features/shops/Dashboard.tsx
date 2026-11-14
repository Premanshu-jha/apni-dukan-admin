import { Link, useSearchParams } from 'react-router'
import { useDashboard, useLicencesToFollowUp } from '../../api/admin'
import { explain } from '../../api/errors'
import type { ShopType } from '../../api/types'
import { Tabs } from '../../components/Tabs'
import { useAdmin } from '../../app/guards'
import { Banner, ErrorState, Loading, Page } from '../../components/ui'
import { isSuperAdmin } from '../../lib/roles'
import { GROUP_LABELS, GROUPS, isShopType, SHOP_TYPES, TYPE_LABELS } from '../../lib/labels'

/**
 * The six counts for kirana or salon; each opens its list. The tab is kept in the address (?type=SALON). A field
 * agent's counts are only the businesses assigned to them.
 */
export function Dashboard() {
  const superAdmin = isSuperAdmin(useAdmin().adminRole)
  const [params, setParams] = useSearchParams()
  const raw = params.get('type')
  const type: ShopType = isShopType(raw) ? raw : 'KIRANA'
  const board = useDashboard()
  const licences = useLicencesToFollowUp(superAdmin && type === 'SALON')

  return (
    <Page title="Businesses">
      {!superAdmin && <p className="text-sm text-muted">Only the businesses assigned to you (by the pincodes you cover).</p>}
      <Tabs
        label="Business type"
        value={type}
        options={SHOP_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
        onChange={(t) => setParams({ type: t }, { replace: true })}
      />
      {board.isPending ? (
        <Loading />
      ) : board.isError && !board.data ? (
        <ErrorState message={explain(board.error)} onRetry={() => void board.refetch()} />
      ) : (
        <>
          {board.isError && <Banner tone="warn">Couldn't refresh the counts: {explain(board.error)}</Banner>}
          <ul className="flex flex-col gap-2" aria-label={`${TYPE_LABELS[type]} businesses by group`}>
            {GROUPS.map((g) => {
              const count = board.data[type]?.[g] ?? 0
              return (
                <li key={g}>
                  <Link
                    to={`/shops?type=${type}&group=${g}`}
                    aria-label={`${GROUP_LABELS[g]}: ${count}`}
                    className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-surface px-4 hover:bg-raised"
                  >
                    <span className="font-medium">{GROUP_LABELS[g]}</span>
                    <span className={`text-2xl font-bold ${count > 0 && (g === 'FIRST_VISIT' || g === 'RECHECK') ? 'text-link' : 'text-ink'}`}>
                      {count}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {superAdmin && type === 'SALON' && licences.data && (
            <section aria-labelledby="licences" className="flex flex-col gap-2">
              <h2 id="licences" className="font-semibold">
                Trade licences to follow up: {licences.data.length}
              </h2>
              {licences.data.length === 0 ? (
                <p className="text-sm text-muted">None. Licences not accepted, or waiting over half an hour for their check, appear here.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {licences.data.map((s) => (
                    <li key={s.id}>
                      <Link to={`/shops/${s.id}`} className="flex flex-col rounded-2xl border border-line bg-surface p-3 hover:bg-raised">
                        <span className="font-medium [overflow-wrap:anywhere]">
                          #{s.shopCode} {s.name}
                        </span>
                        <span className="text-sm text-muted">
                          {s.area}, {s.city}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </Page>
  )
}
