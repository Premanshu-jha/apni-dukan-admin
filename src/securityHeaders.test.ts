import { describe, expect, it } from 'vitest'
import { securityHeaders } from '../security-headers'

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

describe('the security headers and R2', () => {
  it('without PHOTO_ORIGIN, photos and the salon video may come from any R2 address', () => {
    const csp = securityHeaders({ VITE_API_URL: 'https://api.example.com' })['Content-Security-Policy']
    expect(directive(csp, 'media-src')).toBe("media-src 'self' https://*.r2.cloudflarestorage.com")
  })

  it('a set PHOTO_ORIGIN (production: the account’s exact R2 address) replaces the wildcard everywhere', () => {
    const exact = 'https://abc123.r2.cloudflarestorage.com'
    const csp = securityHeaders({ VITE_API_URL: 'https://api.example.com', PHOTO_ORIGIN: exact })['Content-Security-Policy']
    expect(csp).not.toContain('*.r2.cloudflarestorage.com')
    expect(directive(csp, 'media-src')).toBe(`media-src 'self' ${exact}`)
    expect(directive(csp, 'img-src')).toBe(`img-src 'self' data: blob: ${exact}`)
  })
})
