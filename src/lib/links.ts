/** Google Maps directions to a point (opens the Maps app on a phone). */
export function directionsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}

/** A tel: link for a stored 10-digit Indian number; null when there is no number. */
export function telUrl(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `tel:+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `tel:+${digits}`
  return null
}

/** "350 m" or "1.2 km" for how far a pin moved. */
export function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}
