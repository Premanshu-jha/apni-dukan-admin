import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useShopList } from '../../api/admin'
import { explain } from '../../api/errors'
import type { AdminShop } from '../../api/types'
import { Banner, Card, EmptyState, ErrorState, Field, Loading, Page, Pill, Spinner } from '../../components/ui'
import { GROUP_LABELS, isGroup, isShopType, sinceText, TYPE_LABELS } from '../../lib/labels'
import { useDebounced } from '../../lib/useDebounced'
import { useNow } from '../../lib/useNow'

/** The backend sends at most this many; a full page means there may be more. */
const PAGE = 100

/** The shops of one type in one group, oldest first, with a search box. */
export function ShopList() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type')
  const group = params.get('group')
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounced(text.trim(), 300)
  const ok = isShopType(type) && isGroup(group)
  const list = useShopList(ok ? type : 'KIRANA', ok ? group : 'FIRST_VISIT', q)
  const now = useNow(60_000)

  // Keep the search in the address, so Back from a shop comes back to the same results.
  useEffect(() => {
    if (!ok) return
    const next = new URLSearchParams({ type, group })
    if (q) next.set('q', q)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [q, ok, type, group, params, setParams])

  if (!ok) return <Navigate to="/" replace />

  return (
    <Page title={`${TYPE_LABELS[type]}: ${GROUP_LABELS[group]}`} back={`/?type=${type}`}>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Field
          id="search"
          label="Search"
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="#1042, name, owner or phone"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      {list.isFetching && !list.isPending && (
        <div className="flex justify-center">
          <Spinner small label="Searching…" />
        </div>
      )}
      {list.isPending ? (
        <Loading />
      ) : list.isError && !list.data ? (
        <ErrorState message={explain(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <>
          {list.isError && <Banner tone="warn">Couldn't refresh: {explain(list.error)}</Banner>}
          {list.data.length === 0 ? (
            q ? (
              <EmptyState title="No shop matches" body={`Nothing in this list matches "${q}".`} />
            ) : (
              <EmptyState title="Nothing here" body={`No ${TYPE_LABELS[type].toLowerCase()} shop is in "${GROUP_LABELS[group]}" right now.`} />
            )
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Shops">
              {list.data.map((s) => (
                <li key={s.id}>
                  <ShopCard shop={s} now={now} />
                </li>
              ))}
            </ul>
          )}
          {list.data.length >= PAGE && (
            <p className="text-center text-sm text-muted">Showing the oldest {PAGE}. Search to find a shop further down.</p>
          )}
        </>
      )}
    </Page>
  )
}

function ShopCard({ shop, now }: { shop: AdminShop; now: number }) {
  return (
    <Link to={`/shops/${shop.id}`} className="block">
      <Card className="flex min-w-0 flex-col gap-1 hover:bg-raised">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-brand">#{shop.shopCode}</span>
          {shop.group === 'RECHECK' && <Pill tone="warn">Re-check</Pill>}
        </div>
        <p className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{shop.name}</p>
        <p className="min-w-0 text-sm text-muted [overflow-wrap:anywhere]">
          {shop.area}, {shop.city}
        </p>
        <p className="text-sm text-muted">
          {sinceText(shop.group, shop.statusSince, now)}
        </p>
      </Card>
    </Link>
  )
}
