// Look up the status of a specific email by its Resend ID, or return a
// summary of recent notify-zone-slot deliveries.
// Resend doesn't expose a list/search endpoint publicly, so we can only
// query individual IDs. Pass ?id=<resend_email_id> as a query parameter.

export default async function handler(req, res) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })

  const id = (req.query.id || '').toString().trim()
  if (!id) {
    return res.status(400).json({
      error: 'Missing id query param',
      hint: 'Pass ?id=<resend-email-id> from a notify-zone-slot response',
    })
  }

  try {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) {
      return res.status(r.status).json({ error: 'Resend lookup failed', details: json })
    }
    // Resend returns: { id, to, from, subject, html, text, created_at, last_event, ... }
    return res.status(200).json(json)
  } catch (e) {
    return res.status(500).json({ error: 'Fetch failed', message: e.message })
  }
}
