// List emails sent through Resend, newest first, for the hub "Emails" page.
// Resend's List Emails endpoint returns the account-wide history with each
// email's last delivery event (delivered / bounced / complained / ...), which
// is exactly what we need to show a trustworthy, complete history rather than
// the optimistic "sent" count surfaced right after a slot is created.
//
// GET /api/email/list?pages=<n>   (n = max pages of 100, default 10 → 1000 emails)

const RESEND_LIST_URL = 'https://api.resend.com/emails'
const PER_PAGE = 100
const DEFAULT_MAX_PAGES = 10
const HARD_MAX_PAGES = 50

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })

  const requested = parseInt(req.query.pages, 10)
  const maxPages = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), HARD_MAX_PAGES)
    : DEFAULT_MAX_PAGES

  const emails = []
  let after = null
  let hasMore = false

  try {
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(RESEND_LIST_URL)
      url.searchParams.set('limit', String(PER_PAGE))
      if (after) url.searchParams.set('after', after)

      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Surface Resend's actual reason so the UI can show it. A common cause
        // is a "Sending access" API key, which cannot list emails — that needs
        // a "Full access" key.
        const reason =
          json?.message || json?.name || `HTTP ${r.status}`
        return res
          .status(r.status)
          .json({ error: `Resend: ${reason}`, status: r.status, details: json })
      }

      const page = Array.isArray(json.data) ? json.data : []
      emails.push(...page)
      hasMore = Boolean(json.has_more)

      if (!hasMore || page.length === 0) break
      after = page[page.length - 1]?.id
      if (!after) break
    }
  } catch (e) {
    return res.status(500).json({ error: 'Fetch failed', message: e.message })
  }

  // Newest first by creation date (Resend ordering isn't guaranteed).
  emails.sort((a, b) => {
    const ta = new Date(a?.created_at || 0).getTime()
    const tb = new Date(b?.created_at || 0).getTime()
    return tb - ta
  })

  return res.status(200).json({
    count: emails.length,
    has_more: hasMore,
    emails,
  })
}
