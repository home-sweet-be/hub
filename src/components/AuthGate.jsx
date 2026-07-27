import { useState } from 'react'
import { isLoggedIn, login } from '../lib/hubAuth'

// Porte d'accès du hub interne (pas les pages publiques planification-livraison
// / facture). Gate côté client : le vrai verrou est côté serveur, dans
// middleware.js, qui exige le même token sur les endpoints /api/* internes.
export default function AuthGate({ children }) {
  const [authed, setAuthed] = useState(isLoggedIn)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (authed) return children

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(password)
      setAuthed(true)
    } catch (err) {
      setError(err.message || 'Connexion impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hub-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="hub-bg" aria-hidden="true" />
      <form
        onSubmit={handleSubmit}
        className="glass glass--panel"
        style={{ width: 320, maxWidth: '90vw', padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>HomeSweet Hub</h1>
        {error && (
          <div style={{ color: '#c0392b', fontSize: 13 }}>{error}</div>
        )}
        <input
          type="password"
          autoFocus
          required
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--glass-border-inner)',
            font: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Connexion…' : 'Entrer'}
        </button>
      </form>
    </div>
  )
}
