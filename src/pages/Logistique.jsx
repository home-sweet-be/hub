import { useState } from 'react'
import Fournisseurs from './Fournisseurs'
import Receptions from './Receptions'
import PretesLivraison from './PretesLivraison'

const SUPER_TABS = [
  { id: 'fournisseurs', label: 'Fournisseurs', dot: '#ff9f0a' },
  { id: 'receptions', label: 'Réceptions', dot: '#0a84ff' },
  { id: 'pretes', label: 'Prêtes pour la livraison', dot: '#34c759' },
]

export default function Logistique() {
  const [activeTab, setActiveTab] = useState('fournisseurs')

  return (
    <div className="logistique">
      <div className="logistique__tabs">
        {SUPER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              'logistique__tab' + (t.id === activeTab ? ' is-active' : '')
            }
            onClick={() => setActiveTab(t.id)}
          >
            <span
              className="logistique__tab-dot"
              style={{ background: t.dot }}
              aria-hidden="true"
            />
            {t.label}
          </button>
        ))}
      </div>

      <div className="logistique__panel">
        {activeTab === 'fournisseurs' && <Fournisseurs />}
        {activeTab === 'receptions' && <Receptions />}
        {activeTab === 'pretes' && <PretesLivraison />}
      </div>
    </div>
  )
}
