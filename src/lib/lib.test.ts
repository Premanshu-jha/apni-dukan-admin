import { CHECKLIST, CHECKLIST_LABELS, eventLabel, GROUP_LABELS, GROUPS, isGroup, isShopType, sinceText } from './labels'
import { directionsUrl, distanceLabel, telUrl } from './links'
import { formatPhone, normalizePhone } from './phone'
import { isSuperAdmin, isTeam, roleOf, tabsFor } from './roles'
import {
  checkDecision,
  checkNote,
  checkText,
  clean,
  codePoints,
  hasHiddenCharacters,
  lettersOrDigits,
  searchable,
  checkStrikeReason,
  checkTestEmail,
  checkTestPhone,
  decisionsFor,
  needsReason,
  optional,
  reasonFromChecklist,
  validHours,
} from './rules'
import { dateTimeIst, howLong, testModeActive, testModeText, timeIst, untilLabel } from './time'

const NOW = Date.parse('2026-11-05T08:00:00Z') // 1:30 PM in India

describe('groups and labels', () => {
  it('has the six dashboard groups in order with their words', () => {
    expect(GROUPS.map((g) => GROUP_LABELS[g])).toEqual([
      'Waiting for first visit',
      'Re-check after edit',
      'Sent back',
      'Live',
      'Suspended',
      'Closed by the owner',
    ])
    expect(isGroup('CLOSED')).toBe(true)
    expect(isGroup('RECHECK')).toBe(true)
    expect(isGroup('DRAFT')).toBe(false)
    expect(isShopType('SALON')).toBe(true)
    expect(isShopType('salon')).toBe(false)
  })

  it('has the contract checklist labels', () => {
    expect(CHECKLIST.map((c) => CHECKLIST_LABELS[c])).toEqual([
      "Photo doesn't show the name board",
      'Owner photo unclear',
      'Pin is in the wrong place',
      "Address doesn't match",
      "GSTIN / Udyam doesn't match",
      'Business was shut',
      'Other',
    ])
  })

  it('names timeline events, including the owner editing an approved shop', () => {
    expect(eventLabel({ event: 'EDITED', byName: 'Ravi', byAdmin: false })).toBe('Owner changed it after approval')
    expect(eventLabel({ event: 'APPROVED', byName: 'Asha', byAdmin: true })).toBe('Approved by Asha')
    expect(eventLabel({ event: 'SENT_BACK', byName: null, byAdmin: false })).toBe('Sent back')
    expect(eventLabel({ event: 'SUBMITTED', byName: null, byAdmin: false })).toBe('Submitted by the owner')
    expect(eventLabel({ event: 'SUBMITTED', byName: 'Ravi', byAdmin: false })).toBe('Submitted by Ravi')
    expect(eventLabel({ event: 'NOTE', byName: 'Asha', byAdmin: true })).toBe('Note by Asha')
    expect(eventLabel({ event: 'REINSTATED', byName: 'Meera', byAdmin: true })).toBe('Reinstated by Meera')
    expect(eventLabel({ event: 'CLOSED', byName: 'Ravi', byAdmin: false })).toBe('Closed by Ravi (the owner)')
    expect(eventLabel({ event: 'CLOSED', byName: null, byAdmin: false })).toBe('Closed by the owner')
    expect(eventLabel({ event: 'HANDED_OVER', byName: 'Kavita', byAdmin: false })).toBe('Handed over to Kavita')
  })

  it('says how long a shop has been in its group', () => {
    const threeDays = new Date(NOW - 3 * 86400_000).toISOString()
    expect(sinceText('FIRST_VISIT', threeDays, NOW)).toBe('Waiting 3 days')
    expect(sinceText('RECHECK', new Date(NOW - 5 * 3600_000).toISOString(), NOW)).toBe('Waiting 5 h')
    expect(sinceText('SENT_BACK', new Date(NOW - 20 * 60_000).toISOString(), NOW)).toBe('Sent back 20 min ago')
    expect(sinceText('LIVE', new Date(NOW - 86400_000).toISOString(), NOW)).toBe('Live for 1 day')
    expect(sinceText('SUSPENDED', new Date(NOW).toISOString(), NOW)).toBe('Suspended just now')
    expect(sinceText('CLOSED', threeDays, NOW)).toBe('Closed 3 days ago')
    expect(sinceText(null, threeDays, NOW)).toBe('For 3 days')
  })
})

describe('time', () => {
  it('counts how long ago, and treats a time ahead of the phone clock as just now', () => {
    expect(howLong(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now')
    expect(howLong(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now')
    expect(howLong(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe('59 min')
    expect(howLong(new Date(NOW - 23 * 3600_000).toISOString(), NOW)).toBe('23 h')
    expect(howLong(new Date(NOW - 48 * 3600_000).toISOString(), NOW)).toBe('2 days')
    expect(howLong('not a date', NOW)).toBe('just now')
  })

  it('writes times in India time', () => {
    expect(timeIst('2026-11-05T13:00:00Z')).toBe('6:30 PM')
    expect(dateTimeIst('2026-11-05T13:00:00Z')).toBe('Thu 5 Nov, 6:30 PM')
  })

  it("writes the test-mode banner, with the day when it ends after today's midnight in India", () => {
    expect(testModeText('2026-11-05T13:00:00Z', NOW)).toBe('OTP test mode is on until 6:30 PM')
    expect(untilLabel('2026-11-05T19:30:00Z', NOW)).toBe('tomorrow 1:00 AM')
    expect(untilLabel('2026-11-07T05:00:00Z', NOW)).toBe('Sat 7 Nov, 10:30 AM')
    expect(testModeText(null, NOW)).toBe('OTP test mode is on')
  })

  it('shows the banner only while test mode is on and its end has not passed', () => {
    expect(testModeActive({ on: true, until: '2026-11-05T13:00:00Z' }, NOW)).toBe(true)
    expect(testModeActive({ on: true, until: '2026-11-05T07:59:00Z' }, NOW)).toBe(false)
    expect(testModeActive({ on: false, until: null }, NOW)).toBe(false)
    expect(testModeActive({ on: true, until: null }, NOW)).toBe(true)
    expect(testModeActive(undefined, NOW)).toBe(false)
  })
})

describe('decisions and form checks', () => {
  it('offers the decisions each status allows', () => {
    expect(decisionsFor('PENDING_VISIT')).toEqual(['approve', 'reject', 'suspend'])
    expect(decisionsFor('APPROVED')).toEqual(['suspend'])
    expect(decisionsFor('SUSPENDED')).toEqual(['reinstate'])
    expect(decisionsFor('DRAFT')).toEqual([])
    expect(needsReason('reject') && needsReason('suspend')).toBe(true)
    expect(needsReason('approve') || needsReason('reinstate')).toBe(false)
  })

  it('starts a reason from the ticked items in checklist order, leaving out Other', () => {
    expect(reasonFromChecklist(['SHOP_SHUT', 'NAME_BOARD_NOT_VISIBLE', 'OTHER'])).toBe("Photo doesn't show the name board. Business was shut.")
    expect(reasonFromChecklist(['OTHER'])).toBe('')
    expect(reasonFromChecklist([])).toBe('')
  })

  it('checks a reason of 2–200 (cleaned) only where one is needed, and a note of 2–500 only when given', () => {
    expect(checkDecision('reject', '   ', '').reason).toBe('Write a reason for the owner')
    expect(checkDecision('reject', ' a ', '').reason).toBe('Write at least 2 letters or digits')
    expect(checkDecision('suspend', 'ok', '')).toEqual({})
    expect(checkDecision('suspend', 'x'.repeat(200), '')).toEqual({})
    expect(checkDecision('suspend', 'x'.repeat(201), '').reason).toBe('Keep it under 200 characters (now 201)')
    // Spaces are collapsed before counting, as the backend does
    expect(checkDecision('suspend', `a${' '.repeat(300)}b`, '')).toEqual({})
    expect(checkDecision('approve', '', '')).toEqual({})
    expect(checkDecision('approve', '', 'x'.repeat(500))).toEqual({})
    expect(checkDecision('reinstate', '', 'x'.repeat(501)).note).toMatch(/now 501/)
    expect(checkDecision('approve', '', '.').note).toBe('Write at least 2 letters or digits')
  })

  it("follows the backend's TextCleaner: hidden characters, NFKC, code points", () => {
    // A zero-width space (format character) is refused, wherever it is
    expect(hasHiddenCharacters('Shop\u200Bshut')).toBe(true)
    expect(checkText('Shop\u200Bshut', 200, 'empty')).toBe('Contains invisible or special characters')
    expect(checkText('Shop shut\u202E', 200, 'empty')).toBe('Contains invisible or special characters')
    expect(checkText('Shop\u2028shut', 200, 'empty')).toBe('Contains invisible or special characters')
    expect(checkText('Shop\uD800shut', 200, 'empty')).toBe('Contains invisible or special characters')
    expect(checkText('\uE000ab', 200, 'empty')).toBe('Contains invisible or special characters')
    // Tab, newline and carriage return are allowed (pasted text) and collapse to one space
    expect(checkText('Shop\t\r\nshut', 200, 'empty')).toBeUndefined()
    expect(clean('Shop\t\r\n\u00A0\u3000shut')).toBe('Shop shut')
    // Full-width letters pass and become plain ones
    expect(checkText('Ｓｈａｒｍａ', 200, 'empty')).toBeUndefined()
    expect(clean('Ｓｈａｒｍａ')).toBe('Sharma')
    // "ﷺ" is one character typed, 18 after NFKC: counted after, as the backend saves it
    expect(codePoints('ﷺ')).toBe(1)
    expect(codePoints(clean('ﷺ'))).toBe(18)
    expect(checkText('ﷺ'.repeat(12), 200, 'empty')).toBe('Keep it under 200 characters (now 216)')
    // 120 letters and 45 emoji: 210 UTF-16 units but 165 code points, so it fits in 200
    const mixed = 'a'.repeat(120) + '😀'.repeat(45)
    expect(mixed.length).toBe(210)
    expect(checkText(mixed, 200, 'empty')).toBeUndefined()
    // Letters and decimal digits count; other numbers (Roman numerals, fractions) don't
    expect(lettersOrDigits('ⅫⅫ ½½')).toBe(0)
  })

  it('needs at least 2 letters or digits in any script, not just symbols', () => {
    expect(lettersOrDigits('!! ?? ..')).toBe(0)
    expect(lettersOrDigits('ठीक है')).toBeGreaterThanOrEqual(2)
    expect(checkText('!!', 200, 'empty')).toBe('Write at least 2 letters or digits')
    expect(checkText('a!', 200, 'empty')).toBe('Write at least 2 letters or digits')
    expect(checkText('१२', 200, 'empty')).toBeUndefined()
    expect(checkText('  ', 200, 'empty')).toBe('empty')
    expect(clean('  Shop   was\n shut ')).toBe('Shop was shut')
  })

  it('checks a note on its own, a strike reason, a test number and the hours', () => {
    expect(checkNote('  ')).toBe('Write the note')
    expect(checkNote('ok')).toBeUndefined()
    expect(checkNote('x')).toBe('Write at least 2 letters or digits')
    expect(checkNote('x'.repeat(501))).toMatch(/under 500/)
    expect(checkStrikeReason('x')).toBe('Write at least 2 letters or digits')
    expect(checkStrikeReason('Salon mistake')).toBeUndefined()
    expect(checkStrikeReason('x'.repeat(201))).toMatch(/under 200/)
    expect(checkTestPhone('12345', '')).toEqual({ phone: 'Enter a 10-digit Indian mobile number', label: 'Say whose number this is' })
    expect(checkTestPhone('+91 90000 00088', 'QA')).toEqual({})
    expect(checkTestPhone('9000000088', 'Q').label).toBe('Write at least 2 letters or digits')
    expect(checkTestPhone('9000000088', 'x'.repeat(61)).label).toMatch(/under 60/)
    expect(checkTestEmail('tester', '')).toEqual({ email: 'Enter an email address, like name@gmail.com', label: 'Say whose email this is' })
    expect(checkTestEmail(' Tester@Gmail.com ', 'QA')).toEqual({})
    expect(checkTestEmail('a b@gmail.com', 'QA').email).toBeDefined()
    expect(checkTestEmail('a@gmail.com', 'Q').label).toBe('Write at least 2 letters or digits')
    expect([0, 1, 8, 9, 2.5].map(validHours)).toEqual([false, true, true, false, false])
    expect(optional('  ')).toBeUndefined()
    expect(optional(' hi   there ')).toBe('hi there')
  })
})

describe('links, phones and roles', () => {
  it('builds the Maps directions and phone links', () => {
    expect(directionsUrl(28.627, 77.372)).toBe('https://www.google.com/maps/dir/?api=1&destination=28.627,77.372')
    expect(telUrl('9811122233')).toBe('tel:+919811122233')
    expect(telUrl('919811122233')).toBe('tel:+919811122233')
    expect(telUrl(null)).toBeNull()
    expect(telUrl('123')).toBeNull()
    expect(distanceLabel(349.6)).toBe('350 m')
    expect(distanceLabel(1240)).toBe('1.2 km')
  })

  it('reads Indian mobile numbers', () => {
    expect(normalizePhone('+91 98480 12345')).toBe('9848012345')
    expect(normalizePhone('098480-12345')).toBe('9848012345')
    expect(normalizePhone('5848012345')).toBeNull()
    expect(formatPhone('9848012345')).toBe('98480 12345')
  })

  it('lets only the team in, and shows Team and Test mode to the super admin only', () => {
    expect(isTeam('NONE')).toBe(false)
    expect(isTeam('ADMIN') && isTeam('SUPER_ADMIN')).toBe(true)
    expect(isSuperAdmin('ADMIN')).toBe(false)
    expect(roleOf(null)).toBe('NONE')
    expect(roleOf({ id: 'u', phone: null, name: null, email: null, emailVerified: false, admin: true })).toBe('NONE')
    // A field agent: only their visits (Support, Team and Test mode are for super admins)
    expect(tabsFor('ADMIN').map((t) => t.label)).toEqual(['Businesses', 'More'])
    expect(tabsFor('SUPER_ADMIN').map((t) => t.label)).toEqual(['Businesses', 'Support', 'Team', 'Test mode', 'More'])
  })
})

describe('search box', () => {
  it('sends nothing for 1 or 2 letters (with a hint), a shop number at any length, 3 letters or more', () => {
    expect(searchable('')).toEqual({ q: '', tooShort: false })
    expect(searchable('  ')).toEqual({ q: '', tooShort: false })
    expect(searchable('g')).toEqual({ q: '', tooShort: true })
    expect(searchable(' gu ')).toEqual({ q: '', tooShort: true })
    expect(searchable('7')).toEqual({ q: '7', tooShort: false })
    expect(searchable('#42')).toEqual({ q: '#42', tooShort: false })
    expect(searchable('#')).toEqual({ q: '', tooShort: true })
    expect(searchable(' gup ')).toEqual({ q: 'gup', tooShort: false })
    // Counted as the backend counts (code points): an emoji is one character, two are still too short
    expect(searchable('😀😀')).toEqual({ q: '', tooShort: true })
    expect(searchable('डाक')).toEqual({ q: 'डाक', tooShort: false })
  })
})
