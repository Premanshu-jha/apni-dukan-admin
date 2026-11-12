import { useState } from 'react'
import { adminApi } from '../../api/admin'
import { explain, fieldError, isApiError } from '../../api/errors'
import type { AddressIn, AddressRequest, AdminShop } from '../../api/types'
import { Banner, Button, Card, Field } from '../../components/ui'
import { directionsUrl, distanceLabel } from '../../lib/links'
import { dateTimeIst } from '../../lib/time'

/** A pin on Google Maps, to compare the old and the new place. */
export function mapUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

/** Metres between two pins (the same formula as the backend's pinMovedMetres). */
export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

function addressText(a: Pick<AddressIn, 'addressLine' | 'area' | 'city' | 'pincode'>): string {
  return `${a.addressLine}, ${a.area}, ${a.city} ${a.pincode}`
}

/**
 * The owner's address change request: the address now and the one asked for, each with its pin on Google Maps, and
 * how far the pin moves. Approve (below, with the business's other changes) applies it; Decline asks for the reason
 * the owner is told.
 */
export function AddressRequestCard({
  shop,
  request,
  waiting,
  canAct,
  onDone,
  onConflict,
}: {
  shop: AdminShop
  request: AddressRequest
  /** The business waits for a decision now (Approve is offered). */
  waiting: boolean
  canAct: boolean
  onDone: (updated: AdminShop, text: string) => void
  onConflict: (e: unknown) => void
}) {
  const [declining, setDeclining] = useState(false)
  /** The version on screen when Decline was opened: a request changed since answers SHOP_CHANGED, not refused unseen. */
  const [seen, setSeen] = useState<number | null>(shop.version)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decline() {
    setBusy(true)
    setError(null)
    try {
      // After a conflict and Reload: the version reloaded, which the admin has looked at
      const updated = await adminApi.declineAddressRequest(shop.id, seen ?? shop.version, reason.trim())
      setDeclining(false)
      setReason('')
      onDone(updated, 'Address change declined. The owner was told why and keeps the old address.')
    } catch (e) {
      if (isApiError(e, 'SHOP_CHANGED') || isApiError(e, 'WRONG_STATUS') || isApiError(e, 'NO_ADDRESS_REQUEST')) {
        setSeen(null)
        onConflict(e)
      } else setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  const moved = Math.round(metresBetween(shop, request))
  return (
    <section aria-labelledby="address-request" className="flex flex-col gap-2">
      <h2 id="address-request" className="font-semibold">
        The owner asks for a new address
      </h2>
      <Card className="flex flex-col gap-3 border-warn/50">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Now</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            {addressText(shop)}{' '}
            <a href={mapUrl(shop.latitude, shop.longitude)} target="_blank" rel="noopener noreferrer" className="text-link underline">
              Pin now
            </a>
          </dd>
          <dt className="text-muted">Asked</dt>
          <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">
            {addressText(request)}{' '}
            <a href={mapUrl(request.latitude, request.longitude)} target="_blank" rel="noopener noreferrer" className="font-normal text-link underline">
              New pin
            </a>{' '}
            <a href={directionsUrl(request.latitude, request.longitude)} target="_blank" rel="noopener noreferrer" className="font-normal text-link underline">
              Navigate there
            </a>
          </dd>
        </dl>
        <p className="text-sm text-muted">
          Asked {dateTimeIst(request.createdAt)}. {moved > 0 ? `The pin moves ${distanceLabel(moved)}. ` : 'The pin stays. '}
          Customers see the old address until you approve.{' '}
          {waiting
            ? "Approve (below) makes this the business's address; the owner is told."
            : 'It is applied when you approve the business after its visit, or set it now with Change address.'}
        </p>
        {canAct && !declining && (
          <Button
            variant="secondary"
            onClick={() => {
              setSeen(shop.version)
              setDeclining(true)
            }}
          >
            Decline the new address
          </Button>
        )}
        {declining && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-muted">Why (the owner is told)</span>
              <textarea
                value={reason}
                maxLength={200}
                rows={2}
                onChange={(e) => setReason(e.target.value)}
                className="rounded-xl border border-line bg-surface p-3 text-base text-ink focus:border-brand focus:outline-none"
              />
            </label>
            <Button variant="danger" busy={busy} disabled={reason.trim().length < 2 || !canAct} onClick={decline}>
              Decline
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDeclining(false)}>
              Keep it waiting
            </Button>
          </div>
        )}
        {error && <Banner tone="bad">{error}</Banner>}
      </Card>
    </section>
  )
}

type Form = Record<'addressLine' | 'area' | 'city' | 'pincode' | 'latitude' | 'longitude', string>

function formOf(shop: AdminShop): Form {
  return {
    addressLine: shop.addressLine,
    area: shop.area,
    city: shop.city,
    pincode: shop.pincode,
    latitude: String(shop.latitude),
    longitude: String(shop.longitude),
  }
}

/** The same limits as the backend's AddressChange. */
export function checkAddress(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {}
  const len = (v: string, min: number, max: number) => v.trim().length >= min && v.trim().length <= max
  if (!len(f.addressLine, 5, 200)) e.addressLine = 'Enter the shop number, building and street (5 to 200 letters)'
  if (!len(f.area, 2, 100)) e.area = 'Enter the area (2 to 100 letters)'
  if (!len(f.city, 2, 60)) e.city = 'Enter the city (2 to 60 letters)'
  if (!/^[1-9]\d{5}$/.test(f.pincode.trim())) e.pincode = 'Enter the 6-digit pincode'
  const lat = Number(f.latitude)
  const lng = Number(f.longitude)
  if (!f.latitude.trim() || !Number.isFinite(lat) || lat < 6 || lat > 37.6) e.latitude = 'A latitude in India, like 17.4401'
  if (!f.longitude.trim() || !Number.isFinite(lng) || lng < 68 || lng > 97.5) e.longitude = 'A longitude in India, like 78.3489'
  return e
}

/**
 * The field team sets the business's address and pin themselves (at the visit, or after a call): the fields, the pin
 * from this phone's location (standing at the door) or typed, and a link to check it on Google Maps. No re-check (they
 * checked it); a waiting request from the owner is answered by it; the owner is told.
 */
export function ChangeAddress({
  shop,
  request,
  canAct,
  onDone,
  onConflict,
}: {
  shop: AdminShop
  /** The owner's waiting request, to start from it. */
  request: AddressRequest | null
  canAct: boolean
  onDone: (updated: AdminShop, text: string) => void
  onConflict: (e: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(shop))
  /**
   * The version on screen when the form was opened (null after a conflict: then the one reloaded, which the admin
   * has looked at): a change made meanwhile answers SHOP_CHANGED instead of being overwritten.
   */
  const [seen, setSeen] = useState<number | null>(null)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [locError, setLocError] = useState<string | null>(null)
  const problems = checkAddress(form)
  const show = (k: keyof Form) => (touched ? problems[k] : undefined) ?? fieldError(error, k)
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function start() {
    setForm(formOf(shop))
    setSeen(shop.version)
    setTouched(false)
    setError(null)
    setLocError(null)
    setOpen(true)
  }

  function locate() {
    setLocError(null)
    if (!('geolocation' in navigator)) {
      setLocError("This browser can't share a location. Type the pin.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        setForm((f) => ({ ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }))
      },
      () => {
        setLocating(false)
        setLocError("Couldn't get this phone's location. Allow location, or type the pin.")
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function save() {
    setTouched(true)
    setError(null)
    setLocError(null)
    if (Object.keys(problems).length) return
    const now = formOf(shop)
    if ((Object.keys(now) as Array<keyof Form>).every((k) => (k === 'latitude' || k === 'longitude' ? Number(form[k]) === Number(now[k]) : form[k].trim() === now[k]))) {
      setLocError('That is its address and pin now: change something first.')
      return
    }
    setBusy(true)
    try {
      const updated = await adminApi.changeAddress(shop.id, seen ?? shop.version, {
        addressLine: form.addressLine.trim(),
        area: form.area.trim(),
        city: form.city.trim(),
        pincode: form.pincode.trim(),
        latitude: Number(Number(form.latitude).toFixed(6)),
        longitude: Number(Number(form.longitude).toFixed(6)),
      })
      setOpen(false)
      onDone(updated, 'Address changed. Customers see the new one; the owner is told.')
    } catch (e) {
      if (isApiError(e, 'SHOP_CHANGED') || isApiError(e, 'WRONG_STATUS')) {
        // The form stays as typed; after Reload, Save again sends it against what was reloaded
        setSeen(null)
        setError(e)
        onConflict(e)
      } else setError(e)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    if (!canAct) return null
    return (
      <Button variant="secondary" onClick={start}>
        Change address
      </Button>
    )
  }
  const lat = Number(form.latitude)
  const lng = Number(form.longitude)
  const general = error && !(['addressLine', 'area', 'city', 'pincode', 'latitude', 'longitude'] as const).some((k) => fieldError(error, k))
    ? explain(error)
    : null
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-semibold">Change address</p>
      <p className="text-sm text-muted">
        Customers see the new address at once, and the owner is told. No re-check: you are checking it now.
      </p>
      {request && (
        <Button
          variant="secondary"
          onClick={() =>
            setForm({
              addressLine: request.addressLine,
              area: request.area,
              city: request.city,
              pincode: request.pincode,
              latitude: String(request.latitude),
              longitude: String(request.longitude),
            })
          }
        >
          Start from the owner's new address
        </Button>
      )}
      <Field id="new-address" label="Shop number, building, street" value={form.addressLine} maxLength={200} onChange={set('addressLine')} error={show('addressLine')} />
      <Field id="new-area" label="Area" value={form.area} maxLength={100} onChange={set('area')} error={show('area')} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="new-city" label="City" value={form.city} maxLength={60} onChange={set('city')} error={show('city')} />
        <Field id="new-pincode" label="Pincode" inputMode="numeric" value={form.pincode} maxLength={6} onChange={set('pincode')} error={show('pincode')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="new-lat" label="Latitude" inputMode="decimal" value={form.latitude} onChange={set('latitude')} error={show('latitude')} />
        <Field id="new-lng" label="Longitude" inputMode="decimal" value={form.longitude} onChange={set('longitude')} error={show('longitude')} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Button variant="secondary" busy={locating} onClick={locate}>
          Use this phone's location
        </Button>
        {!problems.latitude && !problems.longitude && (
          <a href={mapUrl(lat, lng)} target="_blank" rel="noopener noreferrer" className="text-link underline">
            Check the pin on Google Maps
          </a>
        )}
      </div>
      {locError && <Banner tone="warn">{locError}</Banner>}
      {general && <Banner tone="bad">{general}</Banner>}
      <Button busy={busy} disabled={!canAct} onClick={save}>
        Save the new address
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </Card>
  )
}

