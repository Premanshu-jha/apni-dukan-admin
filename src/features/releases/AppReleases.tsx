import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { adminApi, keys, useAppReleases } from '../../api/admin'
import { explain, isApiError } from '../../api/errors'
import type { AppName, AppRelease, AppUpdateSettings } from '../../api/types'
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Page, Pill, Sheet } from '../../components/ui'
import { dateTimeIst } from '../../lib/time'

const APPS: { app: AppName; label: string }[] = [
  { app: 'partner', label: 'Partner app' },
  { app: 'customer', label: 'Customer app' },
]

/**
 * App releases (super admin only): the screen updates CI sends after each merge, per Play Store app. Pull back a bad
 * one (phones go back to the one before when they next open the app), put it back, and set which app version is on
 * the Play Store and which is the oldest still allowed.
 */
export function AppReleases() {
  const [app, setApp] = useState<AppName>('partner')
  return (
    <Page title="App releases" back="/more">
      <Banner tone="info">
        After each merge, the app&apos;s new screens arrive here and go live. A phone fetches them the next time the
        app is opened and uses them from the opening after that. If a release has a problem, pull it back: phones move
        back to the release before it the same way, over their next two openings.
      </Banner>
      <div className="flex gap-2" role="group" aria-label="Which app">
        {APPS.map((a) => (
          <Chip key={a.app} selected={app === a.app} onClick={() => setApp(a.app)}>
            {a.label}
          </Chip>
        ))}
      </div>
      <OneApp key={app} app={app} />
    </Page>
  )
}

function OneApp({ app }: { app: AppName }) {
  const list = useAppReleases(app)
  if (list.isPending) return <Loading />
  if (list.isError && !list.data) return <ErrorState message={explain(list.error)} onRetry={() => void list.refetch()} />
  const settings = list.data.pages[0].settings
  const releases = list.data.pages.flatMap((p) => p.releases)
  const newestLive = releases.find((r) => r.status === 'LIVE')?.build
  return (
    <>
      {(list.isRefetchError || list.isFetchNextPageError) && (
        <Banner tone="bad">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Couldn&apos;t load the newest list, so what you see may be out of date. {explain(list.error)}
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </span>
        </Banner>
      )}
      {settings.storeVersionCode === null && releases.some((r) => r.status === 'LIVE') && (
        <Banner tone="warn">
          No Play Store version is filled in below, so phones from the Play Store get none of these releases yet (test
          APKs do). Fill it in once Google has approved a version.
        </Banner>
      )}
      <Settings app={app} settings={settings} />
      <section aria-labelledby="releases" className="flex flex-col gap-2">
        <h2 id="releases" className="font-semibold">
          Releases
        </h2>
        {releases.length === 0 ? (
          <EmptyState
            title="No releases yet"
            body="They appear here after the next merge to main, once the app's release token and signing key are set on GitHub."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Releases">
            {releases.map((r) => (
              <li key={r.build}>
                <ReleaseCard app={app} release={r} newest={r.build === newestLive} before={liveBefore(releases, r.build)} />
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Show older releases
          </Button>
        )}
      </section>
    </>
  )
}

/** The live release phones fall back to when this one is pulled back (the newest live one below it). */
function liveBefore(releases: AppRelease[], build: number): number | undefined {
  return releases.find((r) => r.build < build && r.status === 'LIVE')?.build
}

function ReleaseCard({ app, release: r, newest, before }: { app: AppName; release: AppRelease; newest: boolean; before?: number }) {
  const qc = useQueryClient()
  const sending = useRef(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Closes by itself once the list shows it isn't live any more (someone else pulled it back)
  const sheetOpen = asking && r.status === 'LIVE'

  async function change(call: () => Promise<AppRelease>) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await call()
      setAsking(false)
    } catch (e) {
      setError(e)
    } finally {
      sending.current = false
      setBusy(false)
      // Another super admin may have changed it too: read the list again either way
      void qc.invalidateQueries({ queryKey: keys.appReleases(app) })
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold">Build {r.build}</p>
        <div className="flex gap-2">
          {newest && <Pill tone="brand">Newest live</Pill>}
          <StatusPill status={r.status} />
        </div>
      </div>
      <p className="text-sm text-muted">
        Version {r.versionName} · commit {r.commitSha.slice(0, 7)} · {(r.sizeBytes / 1024 / 1024).toFixed(1)} MB · needs
        app level {r.nativeLevel} (phones with an older app from the Play Store keep their screens until they update it)
      </p>
      <p className="text-sm text-muted">
        {r.status === 'UPLOADING'
          ? `Started ${dateTimeIst(r.createdAt)}, not finished: CI stopped before it was live. Phones never get it, nothing to do; the next merge sends a new one.`
          : r.publishedAt
            ? `Live since ${dateTimeIst(r.publishedAt)}`
            : null}
        {r.changedAt && r.changedByName
          ? ` · ${r.status === 'PULLED' ? 'pulled back' : 'put back'} by ${r.changedByName}, ${dateTimeIst(r.changedAt)}`
          : null}
      </p>
      {error !== null && !sheetOpen && <Banner tone="bad">{explain(error)}</Banner>}
      {r.status === 'LIVE' && (
        <Button variant="danger" disabled={busy} onClick={() => setAsking(true)}>
          Pull back
        </Button>
      )}
      {r.status === 'PULLED' && (
        <Button variant="secondary" busy={busy} onClick={() => void change(() => adminApi.restoreRelease(app, r.build))}>
          Put back
        </Button>
      )}
      <Sheet open={sheetOpen} title={`Pull back build ${r.build}?`} onClose={() => setAsking(false)}>
        <p>
          {before
            ? `Phones on it move back to build ${before} over their next two openings of the app.`
            : 'Phones on it move back to the newest live release before it (or, if there is none, to the screens their app came with) over their next two openings of the app.'}{' '}
          You can put it back later.
        </p>
        {error !== null && <Banner tone="bad">{explain(error)}</Banner>}
        <Button variant="danger" busy={busy} onClick={() => void change(() => adminApi.pullBackRelease(app, r.build))}>
          Pull back build {r.build}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAsking(false)}>
          Keep it live
        </Button>
      </Sheet>
    </Card>
  )
}

function StatusPill({ status }: { status: AppRelease['status'] }) {
  if (status === 'LIVE') return <Pill tone="good">Live</Pill>
  if (status === 'PULLED') return <Pill tone="bad">Pulled back</Pill>
  return <Pill tone="muted">Not finished</Pill>
}

/** A whole number of 1 or more, or empty; otherwise what's wrong. */
function versionError(text: string): string | undefined {
  if (text.trim() === '') return undefined
  return /^[1-9]\d{0,9}$/.test(text.trim()) && Number(text) <= 2_100_000_000
    ? undefined
    : 'A version number is a whole number, like 245'
}

function toNumber(text: string): number | null {
  return text.trim() === '' ? null : Number(text.trim())
}

function Settings({ app, settings }: { app: AppName; settings: AppUpdateSettings }) {
  const qc = useQueryClient()
  const sending = useRef(false)
  const [store, setStore] = useState(settings.storeVersionCode?.toString() ?? '')
  const [min, setMin] = useState(settings.minVersionCode?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  // Someone else's change (or ours) read again: show the numbers as they are now
  useEffect(() => {
    setStore(settings.storeVersionCode?.toString() ?? '')
    setMin(settings.minVersionCode?.toString() ?? '')
  }, [settings.version, settings.storeVersionCode, settings.minVersionCode])

  const storeError = versionError(store)
  const minError =
    versionError(min) ??
    (min.trim() !== '' && store.trim() === ''
      ? 'Fill in the Play Store version first'
      : min.trim() !== '' && !storeError && Number(min) > Number(store)
        ? "Can't be newer than the version on the Play Store"
        : undefined)
  // Raising the oldest allowed version blocks every older phone: asked first
  const raisesMin = toNumber(min) !== null && (settings.minVersionCode === null || toNumber(min)! > settings.minVersionCode)
  const [confirming, setConfirming] = useState(false)
  const changed =
    toNumber(store) !== settings.storeVersionCode || toNumber(min) !== settings.minVersionCode

  async function save() {
    if (sending.current || storeError || minError) return
    sending.current = true
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await adminApi.saveAppUpdateSettings(app, {
        storeVersionCode: toNumber(store),
        minVersionCode: toNumber(min),
        version: settings.version,
      })
      setSaved(true)
      setConfirming(false)
    } catch (e) {
      setError(e)
    } finally {
      sending.current = false
      setBusy(false)
      void qc.invalidateQueries({ queryKey: keys.appReleases(app) })
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Who gets what</h2>
      <Field
        id="store-version"
        label="Version on the Play Store"
        inputMode="numeric"
        value={store}
        onChange={(e) => {
          setStore(e.target.value)
          setSaved(false)
        }}
        error={storeError}
        hint="The version code of the newest release Google has approved and is live: Play Console › Test and release › Production, the number in brackets (like 245 (0.30.0)); it is the same as the Build number of the release below. Phones with a newer one (still in Google's review) keep their own screens. Empty: no Play Store phone gets screen updates yet. Test APKs always get them."
      />
      <Field
        id="min-version"
        label="Oldest allowed version"
        inputMode="numeric"
        value={min}
        onChange={(e) => {
          setMin(e.target.value)
          setSaved(false)
        }}
        error={minError}
        hint="A version code too (like 245). Phones with an older version see only “Please update to continue”, so set it only once that version has been on the Play Store for everyone for at least a day. Leave empty so nobody has to update."
      />
      {settings.changedAt && (
        <p className="text-sm text-muted">
          Last changed {settings.changedByName ? `by ${settings.changedByName}, ` : ''}
          {dateTimeIst(settings.changedAt)}
        </p>
      )}
      {error !== null && !confirming && (
        <Banner tone="bad">{isApiError(error, 'VALIDATION_FAILED') ? 'Check the two numbers.' : explain(error)}</Banner>
      )}
      {saved && <Banner tone="good">Saved. Phones follow the next time the app is opened.</Banner>}
      <Button
        busy={busy && !confirming}
        disabled={!changed || Boolean(storeError) || Boolean(minError)}
        onClick={() => (raisesMin ? setConfirming(true) : void save())}
      >
        Save
      </Button>
      <Sheet open={confirming} title={`Block versions older than ${min.trim()}?`} onClose={() => setConfirming(false)}>
        <p>
          Phones with an older version of the app will see only “Please update to continue” until they update from the
          Play Store. Do this only after version {min.trim()} has been on the Play Store for everyone for at least a day.
        </p>
        {error !== null && (
          <Banner tone="bad">{isApiError(error, 'VALIDATION_FAILED') ? 'Check the two numbers.' : explain(error)}</Banner>
        )}
        <Button variant="danger" busy={busy} onClick={() => void save()}>
          Block older versions
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
          Don&apos;t change it
        </Button>
      </Sheet>
    </Card>
  )
}
