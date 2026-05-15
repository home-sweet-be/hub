import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only: emulate Vercel serverless functions (api/**) so `npm run dev`
// can hit /api/shopify/orders without needing `vercel dev`.
function devApiPlugin() {
  return {
    name: 'dev-api-shopify',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()

        const url = new URL(req.url, `http://${req.headers.host}`)
        req.query = Object.fromEntries(url.searchParams)

        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
          return res
        }

        const modulePath = '.' + url.pathname + '.js'
        try {
          const mod = await server.ssrLoadModule(modulePath)
          await mod.default(req, res)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Dev API middleware failure',
              path: modulePath,
              message: err?.message,
            })
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load *all* env vars (including non-VITE_) so the dev middleware can read
  // server-only secrets like SHOPIFY_ADMIN_TOKEN through process.env.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v
  }

  return {
    plugins: [react(), devApiPlugin()],
  }
})
