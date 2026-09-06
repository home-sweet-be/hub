import { useState } from 'react'
import { isLoggedIn, login } from '../lib/hubAuth'
import logo from '../assets/dazzuro.png'

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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <img
            src={logo}
            alt="DAZZURO"
            style={{ height: 34, width: 'auto', display: 'block', userSelect: 'none' }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              textIndent: '0.3em',
              opacity: 0.6,
            }}
          >
            Hub
          </h1>
        </div>
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
