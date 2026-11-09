/** Most pincodes one field agent may cover (AdminTeamService.MAX_PINCODES). */
export const MAX_PINCODES = 300

/** The backend's pincode rule (admin_pincodes, shops.pincode): 6 digits, not starting with 0. */
export const PINCODE = /^[1-9]\d{5}$/

export function isPincode(text: string): boolean {
  return PINCODE.test(text)
}

/** What the pincode box keeps while typing one: digits only, at most 6. */
export function typedPincode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6)
}

export interface Added {
  /** The list after adding (each pincode once, in the order added). */
  next: string[]
  /** Newly added ones. */
  added: string[]
  /** Already in the list (the screen highlights them). */
  duplicates: string[]
  /** Pieces that aren't pincodes, as typed. */
  invalid: string[]
  /** Valid ones left out because the list is full (MAX_PINCODES). */
  overLimit: number
}

/**
 * Adds every pincode in `text` (one, or several pasted with commas, spaces or new lines) to `list`. Each one is
 * added once; anything that isn't a pincode is returned to show, not added.
 */
export function addPincodes(list: string[], text: string): Added {
  const next = [...list]
  const added: string[] = []
  const duplicates: string[] = []
  const invalid: string[] = []
  let overLimit = 0
  for (const piece of text.split(/[\s,;]+/).filter(Boolean)) {
    if (!isPincode(piece)) invalid.push(piece)
    else if (next.includes(piece)) {
      if (!duplicates.includes(piece)) duplicates.push(piece)
    } else if (next.length >= MAX_PINCODES) {
      overLimit++
    } else {
      next.push(piece)
      added.push(piece)
    }
  }
  return { next, added, duplicates, invalid, overLimit }
}

/** True when pasted text holds more than one pincode, or anything a single typed pincode can't (separators). */
export function looksLikeAList(text: string): boolean {
  return /[\s,;]/.test(text.trim()) || text.replace(/\D/g, '').length > 6
}
