/** "10:00" (24-hour, as the backend sends it) as "10:00 AM"; "24:00" is midnight. */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h === 24) return 'midnight'
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** "₹150", or "from ₹150" when the price can go up at the salon; paise shown only when there are any. */
export function rupees(paise: number, isFrom: boolean): string {
  const digits = paise % 100 === 0 ? 0 : 2
  const amount = (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${isFrom ? 'from ' : ''}₹${amount}`
}
