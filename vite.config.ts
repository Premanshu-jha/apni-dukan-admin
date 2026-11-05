import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The Content-Security-Policy in index.html is for the built site (and the end-to-end tests, which run the build).
 * The dev server needs inline scripts for hot reload, so it serves the page without it.
 */
function noCspInDev(): Plugin {
  return {
    name: 'no-csp-in-dev',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/, ''),
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), noCspInDev()],
  server: { port: 5175 },
})
