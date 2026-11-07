/**
 * The security headers of the built site, worked out from the build's settings. One list for both servers of the
 * build: Caddy on Railway (the build writes them to dist/security-headers.caddy, which the Caddyfile imports) and
 * `vite preview`, which the end-to-end tests run, so every end-to-end test runs under the same policy.
 *
 * What the app loads, and from where:
 * - its own scripts, styles, icons and service worker ('self');
 * - the backend (VITE_API_URL): every API call;
 * - Cloudflare Turnstile (only when VITE_TURNSTILE_SITE_KEY is set): its script and its frame;
 * - shop and owner photos: signed links to Cloudflare R2 (PHOTO_ORIGIN, default any *.r2.cloudflarestorage.com
 *   address).
 * Styles allow 'unsafe-inline': the Turnstile widget sets inline styles. Scripts never run inline.
 */
export interface HeaderSettings {
  VITE_API_URL?: string
  VITE_TURNSTILE_SITE_KEY?: string
  PHOTO_ORIGIN?: string
}

const TURNSTILE = 'https://challenges.cloudflare.com'
const R2 = 'https://*.r2.cloudflarestorage.com'

/** The origin of a URL (the app falls back to the local backend, so does this). */
function originOf(url: string | undefined): string {
  try {
    return new URL(url || 'http://localhost:8080').origin
  } catch {
    return 'http://localhost:8080'
  }
}

export function securityHeaders(env: HeaderSettings): Record<string, string> {
  const api = originOf(env.VITE_API_URL)
  const turnstile = env.VITE_TURNSTILE_SITE_KEY ? ` ${TURNSTILE}` : ''
  const photos = env.PHOTO_ORIGIN || R2
  const csp = [
    "default-src 'self'",
    `script-src 'self'${turnstile}`,
    `frame-src ${turnstile ? TURNSTILE : "'none'"}`,
    `connect-src 'self' ${api}`,
    `img-src 'self' data: blob: ${photos}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    // Nothing of the phone is used (directions open Google Maps); all off, for this page and any frame in it
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=()',
  }
}

/** The same headers as a Caddyfile snippet (a `header` block), for the Caddyfile's `import`. */
export function caddyHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([name, value]) => `\t${name} "${value}"`)
  return `# Written by the build from security-headers.ts. Do not edit: change security-headers.ts.\nheader {\n${lines.join('\n')}\n}\n`
}
