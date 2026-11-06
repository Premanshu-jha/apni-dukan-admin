/** The Cloudflare Turnstile site key (public). Empty = no robot check (a local backend without a secret). */
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || ''
