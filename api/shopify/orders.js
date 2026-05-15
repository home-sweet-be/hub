const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01'

export default async function handler(req, res) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN

  if (!domain || !token) {
    return res.status(500).json({
      error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars',
    })
  }

  const limit = Math.min(Number(req.query.limit) || 50, 250)
  const status = req.query.status || 'any'

  const url = new URL(`https://${domain}/admin/api/${API_VERSION}/orders.json`)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('status', status)

  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      return res.status(response.status).json({
        error: 'Shopify API error',
        status: response.status,
        details: text,
      })
    }

    const data = await response.json()
    res.setHeader('Cache-Control', 'private, max-age=10')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', message: err.message })
  }
}
