import source from '../public/sw.js?raw'

/**
 * public/sw.js, run against a stand-in for the browser's service worker globals: the offline page and the wait for
 * "Reload".
 */
const ORIGIN = 'https://app.test'

type Handler = (event: Record<string, unknown>) => void

function loadWorker() {
  const handlers: Record<string, Handler> = {}
  const stored = new Map<string, Response>()
  const self = {
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    location: { origin: ORIGIN },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
    clients: { claim: vi.fn(async () => {}) },
  }
  const caches = {
    open: async () => ({
      addAll: async (requests: Array<{ url: string }>) => {
        for (const r of requests) stored.set(new URL(r.url).pathname, new Response(`kept ${new URL(r.url).pathname}`))
      },
    }),
    keys: async () => ['offline-v0', 'offline-v1'],
    delete: vi.fn(async () => true),
    match: async (path: string) => stored.get(path)?.clone(),
  }
  class WorkerRequest {
    url: string
    constructor(url: string) {
      this.url = new URL(url, ORIGIN).href
    }
  }
  const network = vi.fn<(request: unknown) => Promise<Response>>()
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, network, WorkerRequest)

  /** Fires an event; resolves with what it passed to waitUntil / respondWith. */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    const waits: Array<Promise<unknown>> = []
    let response: Promise<Response> | undefined
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (response = p) })
    await Promise.all(waits)
    return { response }
  }
  return { self, caches, network, fire }
}

describe('service worker', () => {
  it('installs without taking over; only the app\'s "Reload" makes it skip waiting', async () => {
    const { self, fire } = loadWorker()
    await fire('install')
    expect(self.skipWaiting).not.toHaveBeenCalled()
    await fire('message', { data: { kind: 'something else' } })
    expect(self.skipWaiting).not.toHaveBeenCalled()
    await fire('message', { data: { kind: 'skip-waiting' } })
    expect(self.skipWaiting).toHaveBeenCalledOnce()
  })

  it('on activating, drops older offline copies and takes control', async () => {
    const { self, caches, fire } = loadWorker()
    await fire('activate')
    expect(caches.delete).toHaveBeenCalledWith('offline-v0')
    expect(caches.delete).not.toHaveBeenCalledWith('offline-v1')
    expect(self.clients.claim).toHaveBeenCalled()
  })

  it('opening a page without a connection shows the offline page', async () => {
    const { network, fire } = loadWorker()
    await fire('install')
    network.mockRejectedValue(new TypeError('Failed to fetch'))
    const { response } = await fire('fetch', {
      request: { mode: 'navigate', url: `${ORIGIN}/shops` },
      preloadResponse: Promise.resolve(undefined),
    })
    expect(await (await response!).text()).toBe('kept /offline.html')
  })

  it('opening a page with a connection gets the page from the network (the preloaded answer first)', async () => {
    const { network, fire } = loadWorker()
    await fire('install')
    const preloaded = await fire('fetch', {
      request: { mode: 'navigate', url: `${ORIGIN}/` },
      preloadResponse: Promise.resolve(new Response('the app, preloaded')),
    })
    expect(await (await preloaded.response!).text()).toBe('the app, preloaded')
    network.mockResolvedValue(new Response('the app'))
    const fetched = await fire('fetch', { request: { mode: 'navigate', url: `${ORIGIN}/` }, preloadResponse: Promise.resolve(undefined) })
    expect(await (await fetched.response!).text()).toBe('the app')
  })

  it('leaves API calls and the app\'s own files to the network; the offline page\'s CSS comes from its copy offline', async () => {
    const { network, fire } = loadWorker()
    await fire('install')
    const api = await fire('fetch', { request: { mode: 'cors', url: 'https://api.example.com/api/v1/admin/me' } })
    expect(api.response).toBeUndefined()
    const asset = await fire('fetch', { request: { mode: 'no-cors', url: `${ORIGIN}/assets/index-abc.js` } })
    expect(asset.response).toBeUndefined()
    network.mockRejectedValue(new TypeError('Failed to fetch'))
    const css = await fire('fetch', { request: { mode: 'no-cors', url: `${ORIGIN}/offline.css` } })
    expect(await (await css.response!).text()).toBe('kept /offline.css')
  })
})
