import { Link, useSearchParams } from 'react-router'
import { useDashboard } from '../../api/admin'
import { explain } from '../../api/errors'
import type { ShopType } from '../../api/types'
import { Tabs } from '../../components/Tabs'
import { Banner, ErrorState, Loading, Page } from '../../components/ui'
import { GROUP_LABELS, GROUPS, isShopType, SHOP_TYPES, TYPE_LABELS } from '../../lib/labels'

/** The five counts for kirana or salon; each opens its list. The tab is kept in the address (?type=SALON). */
export function Dashboard() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('type')
  const type: ShopType = isShopType(raw) ? raw : 'KIRANA'
  const board = useDashboard()

  return (
    <Page title="Shops">
      <Tabs
        label="Shop type"
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
          <ul className="flex flex-col gap-2" aria-label={`${TYPE_LABELS[type]} shops by group`}>
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
                    <span className={`text-2xl font-bold ${count > 0 && (g === 'FIRST_VISIT' || g === 'RECHECK') ? 'text-brand' : 'text-ink'}`}>
                      {count}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Page>
  )
}
