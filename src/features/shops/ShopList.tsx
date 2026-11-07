import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useShopList } from '../../api/admin'
import { explain, fieldError, isNetwork } from '../../api/errors'
import type { AdminShop } from '../../api/types'
import { Banner, Button, Card, EmptyState, ErrorState, Field, Loading, Page, Pill, Spinner } from '../../components/ui'
import { GROUP_LABELS, isGroup, isShopType, sinceText, TYPE_LABELS } from '../../lib/labels'
import { searchable } from '../../lib/rules'
import { useDebounced } from '../../lib/useDebounced'
import { useNow } from '../../lib/useNow'

/** The shops of one type in one group, oldest first, 50 at a time, with a search box. */
export function ShopList() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type')
  const group = params.get('group')
  const [text, setText] = useState(params.get('q') ?? '')
  // 1 or 2 letters aren't sent (the backend refuses them): the whole list stays, with a hint
  const typed = searchable(text)
  const q = useDebounced(typed.q, 300)
  const ok = isShopType(type) && isGroup(group)
  const list = useShopList(ok ? type : 'KIRANA', ok ? group : 'FIRST_VISIT', q)
  const now = useNow(60_000)
  const listRef = useRef<HTMLUListElement | null>(null)
  const countRef = useRef<HTMLParagraphElement | null>(null)
  // Index of the first shop the next page brings (set when "Show more shops" is tapped)
  const focusIndex = useRef<number | null>(null)
  const loaded = list.data?.pages.flat().length ?? 0
  // "You're offline" from a tap on Show more: only for this list as it was then (gone with a new search, group or
  // type, or once a page loads)
  const listKey = `${type} ${group} ${q}`
  const [offlineAt, setOfflineAt] = useState<{ key: string; loaded: number } | null>(null)
  // Leaving this list forgets the note (React's "adjust state while rendering"): coming back to it later, with its
  // pages still cached and the same count, must not bring an old "You're offline" back
  const [shownKey, setShownKey] = useState(listKey)
  if (shownKey !== listKey) {
    setShownKey(listKey)
    setOfflineAt(null)
  }
  const offlineTap = offlineAt !== null && offlineAt.key === listKey && offlineAt.loaded === loaded

  // After "Show more shops", move focus to the first shop that just appeared (keyboard and screen readers). When the
  // page brought nothing (the last page was empty) the button is gone, so focus goes to the count; after a failed
  // page it stays on the button.
  const fetchingMore = list.isFetchingNextPage
  useEffect(() => {
    if (focusIndex.current === null || fetchingMore) return
    if (loaded > focusIndex.current) {
      listRef.current?.querySelector<HTMLAnchorElement>(`a[data-index="${focusIndex.current}"]`)?.focus()
    } else if (!document.activeElement || document.activeElement === document.body) {
      countRef.current?.focus()
    }
    focusIndex.current = null
  }, [loaded, fetchingMore])

  // Keep the search in the address, so Back from a shop comes back to the same results.
  useEffect(() => {
    if (!ok) return
    const next = new URLSearchParams({ type, group })
    if (q) next.set('q', q)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [q, ok, type, group, params, setParams])

  if (!ok) return <Navigate to="/" replace />
  const shops = list.data?.pages.flat() ?? []
  // Not while the last search's answer stands in for this one: its next page belongs to that search
  const more = list.hasNextPage && !list.isPlaceholderData
  const moreFailed = list.isFetchNextPageError
  const refreshFailed = list.isError && !list.isFetchNextPageError

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
          hint={typed.tooShort ? 'Type at least 3 letters (or a shop number like #42).' : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      {list.isFetching && !list.isPending && !list.isFetchingNextPage && (
        <div className="flex justify-center">
          <Spinner small label="Searching…" />
        </div>
      )}
      {list.isPending ? (
        <Loading />
      ) : list.isError && !list.data && fieldError(list.error, 'q') ? (
        // The backend still refused the search (its count of letters differs): say what to do, not "try again"
        <EmptyState title="Type at least 3 letters" body="Or search a shop number like #42, or 3 digits of the owner's phone." />
      ) : list.isError && !list.data ? (
        <ErrorState message={explain(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <>
          {refreshFailed && <Banner tone="warn">Couldn't refresh: {explain(list.error)}</Banner>}
          {shops.length === 0 ? (
            q ? (
              <EmptyState title="No shop matches" body={`Nothing in this list matches "${q}".`} />
            ) : (
              <EmptyState title="Nothing here" body={`No ${TYPE_LABELS[type].toLowerCase()} shop is in "${GROUP_LABELS[group]}" right now.`} />
            )
          ) : (
            <>
              <p ref={countRef} tabIndex={-1} className="text-sm text-muted focus:outline-none">
                {more ? `First ${shops.length} shops` : `${shops.length} ${shops.length === 1 ? 'shop' : 'shops'}`}, longest
                waiting first
              </p>
              <p aria-live="polite" className="sr-only">
                {shops.length} shops shown
              </p>
              <ul ref={listRef} className="flex flex-col gap-2" aria-label="Shops">
                {shops.map((s, i) => (
                  <li key={s.id}>
                    <ShopCard shop={s} now={now} index={i} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {(moreFailed || offlineTap) && (
            <p role="alert" className="text-sm text-bad">
              {offlineTap || isNetwork(list.error)
                ? "You're offline or the server can't be reached. Connect and tap Show more shops again."
                : "Couldn't load more shops. Tap Show more shops to try again."}
            </p>
          )}
          {more && (
            // aria-busy, not disabled: a disabled button would drop the keyboard focus while it loads
            <Button
              variant="secondary"
              aria-busy={list.isFetchingNextPage}
              onClick={() => {
                if (list.isFetchingNextPage) return
                if (!navigator.onLine) {
                  setOfflineAt({ key: listKey, loaded })
                  return
                }
                setOfflineAt(null)
                focusIndex.current = shops.length
                void list.fetchNextPage()
              }}
            >
              {list.isFetchingNextPage ? 'Loading more shops…' : 'Show more shops'}
            </Button>
          )}
        </>
      )}
    </Page>
  )
}

function ShopCard({ shop, now, index }: { shop: AdminShop; now: number; index: number }) {
  return (
    <Link to={`/shops/${shop.id}`} data-index={index} className="block">
      <Card className="flex min-w-0 flex-col gap-1 hover:bg-raised">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-link">#{shop.shopCode}</span>
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
