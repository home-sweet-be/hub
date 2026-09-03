import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZoneFlag, zoneCode } from '../components/ZoneFlag'
import ZoneModal from '../components/ZoneModal'
import AddressModal from '../components/AddressModal'
import StockAdjustModal from '../components/StockAdjustModal'
import OrdersTableSkeleton from '../components/OrdersTableSkeleton'
import { useReload } from '../lib/reload'

const ZONE_TAG_PATTERN = /^(BE|FR|LU|NL|DE|LIV)(-|$)/i

const TABS = [
  {
    id: 'intercommerce',
    label: 'INTERCOMMERCE',
    vendor: 'INTERCOMMERCE',
    supplierTitle: 'intercommerce',
    allowStockAdjust: true,
    filter: (o) =>
      !o.tags.includes('SentToSupplier') &&
      !o.tags.includes('ProduitEnStock') &&
      Number(o.total) >= 590 &&
      o.lineItems.some((li) => isMainLineItem(li) && li.vendor !== 'ELTAP'),
  },
  {
    id: 'eltap',
    label: 'ELTAP',
    vendor: 'ELTAP',
    supplierTitle: 'ELTAP',
    allowStockAdjust: true,
    filter: (o) =>
      !o.tags.includes('SentToSupplier') &&
      !o.tags.includes('ProduitEnStock') &&
      Number(o.total) >= 590 &&
      o.lineItems.some((li) => isMainLineItem(li) && li.vendor === 'ELTAP'),
  },
]

function extractZone(order) {
  const find = (tags) => (tags || []).find((t) => ZONE_TAG_PATTERN.test(t))
  return find(order?.tags) || find(order?.customer?.tags) || null
}


function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function daysSince(iso) {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function customerName(c) {
  if (!c) return ''
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
}

function effectiveQuantity(li) {
  return li.currentQuantity ?? li.quantity ?? 0
}

function activeLineItems(order) {
  return order.lineItems.filter((li) => effectiveQuantity(li) > 0)
}

function isTextureAttr(a) {
  return !!(a?.key && !a.key.startsWith('_') && /texture/i.test(a.key) && a.value)
}

// Valeur de la texture personnalisée d'un line item (ex. « ROSE MAUVE ARAGON 62 »),
// une fois les customAttributes enrichis par enrichRemovedTextures. Affichée comme
// une variante (liste) et accolée au SKU (tableau fournisseur), plutôt qu'en sous-ligne.
function textureValue(li) {
  const a = (li.customAttributes || []).find(isTextureAttr)
  return a?.value || null
}

// Lors d'une réédition de commande, Shopify retire l'ancien line item
// (currentQuantity 0) et en recrée un nouveau — sans toujours recopier ses
// customAttributes. La texture personnalisée (« Texture: ROSE MAUVE ARAGON 62 »)
// se retrouve alors uniquement sur la ligne retirée, et on ne sait plus quel
// tissu envoyer au fournisseur. On la ré-attache ici à la ligne active
// correspondante (même variante), pour que les tableaux Fournisseurs l'affichent.
function enrichRemovedTextures(order) {
  const lineItems = order?.lineItems
  if (!Array.isArray(lineItems)) return order

  // Textures présentes sur les lignes retirées, en file d'attente par variante.
  const removedByVariant = new Map()
  for (const li of lineItems) {
    if (effectiveQuantity(li) > 0) continue
    const key = li.variant?.id || li.sku || li.title
    for (const attr of li.customAttributes || []) {
      if (!isTextureAttr(attr)) continue
      if (!removedByVariant.has(key)) removedByVariant.set(key, [])
      removedByVariant.get(key).push(attr)
    }
  }
  if (removedByVariant.size === 0) return order

  const nextLineItems = lineItems.map((li) => {
    if (effectiveQuantity(li) <= 0) return li
    if ((li.customAttributes || []).some(isTextureAttr)) return li
    const queue = removedByVariant.get(li.variant?.id || li.sku || li.title)
    if (!queue || queue.length === 0) return li
    const recovered = queue.shift()
    return {
      ...li,
      customAttributes: [...(li.customAttributes || []), recovered],
    }
  })
  return { ...order, lineItems: nextLineItems }
}

function isMainLineItem(li) {
  if (li?.title && /[ée]chantillon/i.test(li.title)) return true
  if (li?.image?.url) return true
  const amt = Number(li?.discountedTotalSet?.shopMoney?.amount || 0)
  return amt >= 590
}

function articleLine(li) {
  const parts = [`${effectiveQuantity(li)}× ${li.title}`]
  if (li.variantTitle) parts.push(`/ ${li.variantTitle}`)
  return parts.join(' ')
}

function productsSummary(items) {
  return items.map((li) => `${effectiveQuantity(li)}× ${li.title}`).join(', ')
}

function SubBranch() {
  return (
    <svg
      className="reception-suboption__branch"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 2 L 7 8 L 13 8" />
    </svg>
  )
}

function isSamples(li) {
  return li?.title ? /[ée]chantillon/i.test(li.title) : false
}

function SamplesThumb() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="2" y="5" width="5" height="14" rx="1" fill="#c4956c" />
      <rect x="7.5" y="5" width="5" height="14" rx="1" fill="#9c7b67" />
      <rect x="13" y="5" width="5" height="14" rx="1" fill="#6b8e7f" />
      <rect x="18.5" y="5" width="3.5" height="14" rx="1" fill="#d8c4a1" />
    </svg>
  )
}

export default function Fournisseurs() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('intercommerce')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [pending, setPending] = useState(null) // 'adjust' | 'markReady' | null
  const [feedback, setFeedback] = useState(null) // { type, message }
  const [zoneEditing, setZoneEditing] = useState(null) // order being edited
  const [addressViewing, setAddressViewing] = useState(null) // order whose address is shown
  const [adjustItems, setAdjustItems] = useState(null) // null = closed, [] = open
  const { reloadKey } = useReload()

  const load = useCallback(() => {
    setOrders(null)
    setError(null)
    const cutoff = new Date(Date.now() - 150 * 86400000)
      .toISOString()
      .slice(0, 10)
    return fetch(
      '/api/shopify/receptions?q=' +
        encodeURIComponent(
          `created_at:>=${cutoff} AND NOT tag:SentToSupplier AND NOT tag:ProduitEnStock AND NOT tag:WaitingList AND NOT tag:PretPourLaLivraison AND NOT tag:removed AND status:open AND NOT fulfillment_status:fulfilled AND NOT financial_status:refunded AND NOT financial_status:partially_refunded AND total_price:>1`
        ) +
        '&first=250'
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
        return r.json()
      })
      .then((data) => setOrders((data.orders || []).map(enrichRemovedTextures)))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // Clear selection when changing tab (avoid mixing suppliers in stock adjust)
  useEffect(() => {
    setSelectedIds(new Set())
    setFeedback(null)
  }, [activeTab])

  const activeDef = TABS.find((t) => t.id === activeTab) || TABS[0]

  const filtered = useMemo(() => {
    if (!orders) return []
    return orders
      .filter(activeDef.filter)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
  }, [orders, activeDef])

  const selectedOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => selectedIds.has(o.id))
  }, [orders, selectedIds])

  const selectedRefCount = useMemo(() => {
    const set = new Set()
    for (const o of selectedOrders) {
      for (const li of activeLineItems(o)) {
        const id = li.variant?.inventoryItem?.id
        if (id) set.add(id)
      }
    }
    return set.size
  }, [selectedOrders])

  const addToCart = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      next.add(id)
      return next
    })
  }

  const removeFromCart = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }

  const handleAdjustStock = () => {
    if (selectedOrders.length === 0) return
    setFeedback(null)
    // Aggregate by inventoryItemId across all selected orders
    const byInv = new Map()
    for (const o of selectedOrders) {
      for (const li of activeLineItems(o)) {
        const invId = li.variant?.inventoryItem?.id
        if (!invId) continue
        const prev = byInv.get(invId)
        if (prev) {
          prev.delta += effectiveQuantity(li)
        } else {
          byInv.set(invId, {
            inventoryItemId: invId,
            sku: li.sku || li.variant?.sku || '',
            title: li.title,
            variantTitle: li.variantTitle && !/texture/i.test(li.variantTitle)
              ? li.variantTitle
              : null,
            imageUrl: li.image?.url || null,
            before: typeof li.variant?.inventoryQuantity === 'number'
              ? li.variant.inventoryQuantity
              : null,
            delta: effectiveQuantity(li),
          })
        }
      }
    }
    setAdjustItems([...byInv.values()])
  }

  const applyStockAdjust = async (itemsFromModal) => {
    const list = itemsFromModal || adjustItems
    setPending('adjust')
    try {
      // Step 1 — stock adjustment (skip if everything is 0)
      const stockItems = (list || [])
        .filter((it) => Number(it.delta) !== 0)
        .map((it) => ({
          inventoryItemId: it.inventoryItemId,
          delta: Number(it.delta),
        }))

      if (stockItems.length > 0) {
        const r = await fetch('/api/shopify/inventory/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: stockItems,
            reason: 'received',
          }),
        })
        const data = await r.json()
        if (!r.ok || data.ok === false) {
          throw new Error(
            (data.userErrors ||
              data.errors || [{ message: 'Erreur stock' }])
              .map((e) => e.message)
              .join(' · ')
          )
        }
      }

      // Step 2 — flip tags: SentToSupplier → PretPourLaLivraison
      const customerIds = [
        ...new Set(selectedOrders.map((o) => o.customer?.id).filter(Boolean)),
      ]
      const r2 = await fetch('/api/shopify/orders/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: selectedOrders.map((o) => o.id),
          remove: ['SentToSupplier'],
          add: ['PretPourLaLivraison'],
          customerIds,
          customerAdd: ['SendingBookingEmail'],
        }),
      })
      const data2 = await r2.json()
      if (!r2.ok || data2.hasErrors) {
        const messages = [
          ...(data2.orderResults || []),
          ...(data2.customerResults || []),
        ]
          .flatMap((x) => [...(x.addErrors || []), ...(x.removeErrors || [])])
          .map((e) => e.message)
        throw new Error(messages.join(' · ') || `HTTP ${r2.status}`)
      }

      setFeedback({
        type: 'ok',
        message: `${selectedOrders.length} commande(s) réceptionnée(s) — stock mis à jour et marquée(s) prête(s) pour la livraison.`,
      })
      setAdjustItems(null)
      setSelectedIds(new Set())
      await load()
    } catch (e) {
      throw e
    } finally {
      setPending(null)
    }
  }

  // Export the orders currently shown in the right-hand table (active tab) to
  // an Excel file — one row per order.
  const handleExport = async () => {
    if (selectedOrders.length === 0) return
    // Lazy-load SheetJS (styled fork) so it isn't bundled into the initial
    // app load. xlsx-js-style supports cell fills/fonts that plain xlsx drops.
    const mod = await import('xlsx-js-style')
    const XLSX = mod.default || mod
    // One row per line item (quantity + SKU are per product).
    const rows = []
    for (const o of selectedOrders) {
      const zone = extractZone(o) || ''
      const client = customerName(o.customer)
      const city = o.shippingAddress?.city || ''
      const date = formatDate(o.createdAt)
      const wait = daysSince(o.createdAt)
      for (const li of activeLineItems(o)) {
        rows.push({
          Order: o.name.replace(/^#/, ''),
          Quantity: effectiveQuantity(li),
          SKU: li.sku || li.variant?.sku || '',
          'Dazzuro name': li.title || '',
          Customer: client,
          Zone: zone,
          City: city,
          Date: date,
          'Wait (days)': wait,
        })
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 8 }, // Order
      { wch: 9 }, // Quantity
      { wch: 30 }, // SKU
      { wch: 30 }, // Dazzuro name
      { wch: 22 }, // Customer
      { wch: 14 }, // Zone
      { wch: 18 }, // City
      { wch: 12 }, // Date
      { wch: 10 }, // Wait (days)
    ]

    // Header row: black fill, white bold text. Body: black text, except the
    // Dazzuro name column (less important for the supplier) in grey.
    // All fonts sized 15 (Excel default 11 + 4).
    const FONT_SZ = 15
    const NAME_COL = 3 // 0:Order 1:Quantity 2:SKU 3:Dazzuro name
    const headerStyle = {
      fill: { patternType: 'solid', fgColor: { rgb: '000000' } },
      font: { color: { rgb: 'FFFFFF' }, bold: true, sz: FONT_SZ },
      alignment: { vertical: 'center' },
    }
    const bodyStyle = { font: { color: { rgb: '000000' }, sz: FONT_SZ } }
    const nameStyle = { font: { color: { rgb: '808080' }, sz: FONT_SZ } }
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (!cell) continue
        cell.s = R === 0 ? headerStyle : C === NAME_COL ? nameStyle : bodyStyle
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, activeDef.label.slice(0, 31))

    // Build the .xlsx ourselves and download with the official Excel MIME type
    // so the OS reliably opens it with Excel. We never use XLSX.writeFile here:
    // when bundled it guesses the format from the extension and throws
    // "unknown file extension". write({type:'array'}) returns an ArrayBuffer,
    // which we wrap in a Uint8Array for maximum Blob compatibility.
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([new Uint8Array(buf)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const today = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `commandes-${activeDef.id}-${today}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleMarkSent = async () => {
    if (selectedOrders.length === 0) return
    setPending('markSent')
    setFeedback(null)
    try {
      const r = await fetch('/api/shopify/orders/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: selectedOrders.map((o) => o.id),
          add: ['SentToSupplier'],
        }),
      })
      const data = await r.json()
      if (!r.ok || data.hasErrors) {
        const messages = (data.orderResults || [])
          .flatMap((x) => [...(x.addErrors || []), ...(x.removeErrors || [])])
          .map((e) => e.message)
        throw new Error(messages.join(' · ') || `HTTP ${r.status}`)
      }
      setFeedback({
        type: 'ok',
        message: `${selectedOrders.length} commande(s) marquée(s) comme envoyée(s) au fournisseur.`,
      })
      setSelectedIds(new Set())
      await load()
    } catch (e) {
      setFeedback({ type: 'err', message: e.message })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="page reception page--fournisseurs">
      <div className="reception__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              'reception__tab' + (t.id === activeTab ? ' is-active' : '')
            }
            onClick={() => setActiveTab(t.id)}
          >
            {t.dot && (
              <span
                className="reception__tab-dot"
                style={{ background: t.dot }}
                aria-hidden="true"
              />
            )}
            {t.label}
          </button>
        ))}
      </div>

      <div className="reception__body">
      <div className="reception__panes">
        {/* ---------- Left: reception cart ---------- */}
        <aside className="reception__left">
          <div className="reception__pane-label reception__pane-label--left">Liste de commandes à envoyer</div>

          <div className="reception-cart">
            <table className="reception-cart__table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Produit</th>
                  <th aria-label="action">
                    {selectedOrders.length >= 1 && (
                      <button
                        type="button"
                        className="reception-cart__clear"
                        onClick={() => setSelectedIds(new Set())}
                        title="Tout retirer"
                      >
                        −
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedOrders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="reception-cart__empty">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7" />
                      </svg>
                    </td>
                  </tr>
                )}
                {selectedOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="reception-num">
                        {o.name.replace(/^#/, '')}
                      </span>
                    </td>
                    <td className="reception-cart__products">
                      {(() => {
                        const out = []
                        activeLineItems(o).forEach((li, idx) => {
                          const hasImage = !!li.image?.url
                          const lineAmount = Number(
                            li.discountedTotalSet?.shopMoney?.amount || 0
                          )
                          const isSubLine = !hasImage && lineAmount < 590
                          const wrong =
                            !!activeDef.vendor &&
                            !!li.vendor &&
                            li.vendor !== activeDef.vendor
                          if (wrong) {
                            out.push(
                              <div
                                className="reception-cart__product is-wrong-vendor"
                                key={`l-${idx}`}
                              >
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-wrong-vendor">
                                  ⚠️ {li.title}
                                  {li.vendor ? ` (${li.vendor})` : ''}
                                </span>
                              </div>
                            )
                            return
                          }
                          if (isSubLine) {
                            out.push(
                              <div
                                className="reception-cart__product is-sub"
                                key={`l-${idx}`}
                              >
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {li.title}
                                </span>
                              </div>
                            )
                          } else {
                            out.push(
                              <div
                                className="reception-cart__product"
                                key={`l-${idx}`}
                              >
                                <div className="reception-cart__product-main">
                                  <span className="reception-qty">
                                    {effectiveQuantity(li)}×
                                  </span>
                                  <span className="reception-article__title">
                                    {li.title}
                                  </span>
                                  {li.variantTitle &&
                                    !/texture/i.test(li.variantTitle) && (
                                      <span className="reception-article__variant">
                                        {li.variantTitle}
                                      </span>
                                    )}
                                </div>
                                {(li.sku || li.variant?.sku) && (
                                  <div className="reception-cart__sku">
                                    <span>
                                      {[li.sku || li.variant?.sku, textureValue(li)]
                                        .filter(Boolean)
                                        .join(' ')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )
                          }
                          for (const attr of li.customAttributes || []) {
                            if (!attr.key || attr.key.startsWith('_')) continue
                            if (!attr.value) continue
                            if (isTextureAttr(attr)) continue // accolée au SKU
                            out.push(
                              <div
                                className="reception-cart__product is-sub"
                                key={`a-${idx}-${attr.key}`}
                              >
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {attr.key}: {attr.value}
                                </span>
                              </div>
                            )
                          }
                        })
                        return out
                      })()}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="reception-action reception-action--remove"
                        onClick={() => removeFromCart(o.id)}
                        title="Retirer"
                      >
                        −
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="reception-cart__footer">
              <div className="reception-cart__count">
                {selectedOrders.length} sélectionnée
                {selectedOrders.length > 1 ? 's' : ''}
              </div>

              {feedback && (
                <div
                  className={
                    'reception-cart__feedback reception-cart__feedback--' +
                    feedback.type
                  }
                >
                  {feedback.message}
                </div>
              )}

              <div className="reception-cart__actions">
                {selectedOrders.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--export"
                    onClick={handleExport}
                    title={`Exporter les ${selectedOrders.length} commande(s) de la liste en Excel`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                    Export
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn--orange"
                  disabled={selectedOrders.length === 0 || pending !== null}
                  onClick={handleMarkSent}
                >
                  {pending === 'markSent'
                    ? 'Mise à jour…'
                    : selectedOrders.length === 1
                    ? 'Marquer comme envoyée au fournisseur'
                    : 'Marquer comme envoyées au fournisseur'}
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* ---------- Right: pending receptions ---------- */}
        <section className="reception__right">
          <div className="reception__pane-label reception__pane-label--right">
            Commandes à envoyer au fournisseur
          </div>

          {error && <p style={{ color: '#c00' }}>Erreur : {error}</p>}
          {orders === null && !error && (
            <OrdersTableSkeleton
              columns={9}
              rows={6}
              hasImageCol
              hasActionCol
            />
          )}

          {orders && (
            <div className="reception-table-wrap">
              <table className="reception-table">
                <thead>
                  <tr>
                    <th aria-label="action" />
                    <th aria-label="image" />
                    <th>Produit</th>
                    <th>N°</th>
                    <th>Zone</th>
                    <th>Ville</th>
                    <th>Client</th>
                    <th>Attente</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="reception-table__empty">
                        Aucune commande dans cet onglet.
                      </td>
                    </tr>
                  )}
                  {filtered.flatMap((o) => {
                    const zone = extractZone(o)
                    const isSelected = selectedIds.has(o.id)
                    const items = activeLineItems(o)
                    if (items.length === 0) return []

                    // Build a flat list of rows: each line item, followed by
                    // its visible custom attributes (which render like a
                    // separate sub-line / cheap unimaged line item).
                    const rows = []
                    items.forEach((li) => {
                      const wrong =
                        !!activeDef.vendor &&
                        !!li.vendor &&
                        li.vendor !== activeDef.vendor
                      rows.push({ kind: 'line', li, wrong })
                      if (wrong) return
                      for (const attr of li.customAttributes || []) {
                        if (!attr.key || attr.key.startsWith('_')) continue
                        if (!attr.value) continue
                        if (isTextureAttr(attr)) continue // affichée comme variante
                        rows.push({ kind: 'attr', attr })
                      }
                    })
                    const span = rows.length

                    const isSubRow = (r) => {
                      if (!r) return false
                      if (r.kind === 'attr') return true
                      const x = r.li
                      if (isSamples(x)) return false
                      const amt = Number(
                        x?.discountedTotalSet?.shopMoney?.amount || 0
                      )
                      return !!x && !x.image?.url && amt < 590
                    }
                    return rows.map((row, idx) => {
                      const isFirst = idx === 0
                      const isLast = idx === span - 1
                      const li = row.kind === 'line' ? row.li : null
                      const hasImage = !!li?.image?.url
                      const lineAmount = li
                        ? Number(li.discountedTotalSet?.shopMoney?.amount || 0)
                        : 0
                      const isSubLine = isSubRow(row)
                      const isWrongVendor = row.kind === 'line' && !!row.wrong
                      const nudgeImage =
                        row.kind === 'line' &&
                        hasImage &&
                        !isWrongVendor &&
                        isSubRow(rows[idx + 1])
                      const rowCls = [
                        isSelected ? 'is-selected' : '',
                        span > 1 && !isLast ? 'is-row-mid' : '',
                        span > 1 && !isFirst ? 'is-row-cont' : '',
                        isSubLine && !isWrongVendor ? 'is-row-sub' : '',
                        isSubLine && isLast && !isWrongVendor
                          ? 'is-row-sub--last'
                          : '',
                        isWrongVendor ? 'is-row-wrong-vendor' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <tr key={`${o.id}-${idx}`} className={rowCls}>
                          {isFirst && (
                            <td rowSpan={span}>
                              <button
                                type="button"
                                className="reception-action"
                                onClick={() => addToCart(o.id)}
                                disabled={isSelected}
                                title={
                                  isSelected
                                    ? 'Déjà ajoutée'
                                    : 'Ajouter au panier'
                                }
                              >
                                +
                              </button>
                            </td>
                          )}
                          <td className="reception-img-cell">
                            {row.kind === 'line' && hasImage ? (
                              <img
                                src={li.image.url}
                                alt={li.image.altText || li.title}
                                className={
                                  'reception-thumb' +
                                  (nudgeImage ? ' is-nudged' : '')
                                }
                              />
                            ) : row.kind === 'line' && isSamples(li) ? (
                              <div
                                className="reception-thumb reception-thumb--samples"
                                aria-hidden="true"
                              >
                                <SamplesThumb />
                              </div>
                            ) : isSubLine ? null : row.kind === 'line' ? (
                              <img
                                src="/canapbackup.jpg"
                                alt=""
                                aria-hidden="true"
                                className="reception-thumb"
                              />
                            ) : null}
                          </td>
                          <td className="reception-articles">
                            {isWrongVendor ? (
                              <>
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-wrong-vendor">
                                  ⚠️ {li.title}
                                  {li.vendor ? ` (${li.vendor})` : ''}
                                </span>
                              </>
                            ) : isSubLine ? (
                              <span className="reception-suboption">
                                <SubBranch />
                                <span className="reception-suboption__bubble">
                                  {row.kind === 'attr'
                                    ? `${row.attr.key}: ${row.attr.value}`
                                    : li.title}
                                </span>
                              </span>
                            ) : (
                              <>
                                <span className="reception-qty">
                                  {effectiveQuantity(li)}×
                                </span>
                                <span className="reception-article__title">
                                  {li.title}
                                </span>
                                {(() => {
                                  const variant =
                                    textureValue(li) ||
                                    (li.variantTitle &&
                                    !/texture/i.test(li.variantTitle)
                                      ? li.variantTitle
                                      : null)
                                  return variant ? (
                                    <span className="reception-article__variant">
                                      {variant}
                                    </span>
                                  ) : null
                                })()}
                              </>
                            )}
                          </td>
                          {isFirst && (
                            <td className="reception-num" rowSpan={span}>
                              {o.adminUrl ? (
                                <a
                                  href={o.adminUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="reception-num__link"
                                  title="Ouvrir dans Shopify Admin"
                                >
                                  <span className="reception-num__icon-wrap">
                                    <img
                                      src="/shopify-icon.png"
                                      alt=""
                                      aria-hidden="true"
                                      className="reception-num__icon"
                                    />
                                  </span>
                                  {o.name.replace(/^#/, '')}
                                </a>
                              ) : (
                                o.name.replace(/^#/, '')
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td rowSpan={span}>
                              <button
                                type="button"
                                className={
                                  'zone-badge zone-badge--button' +
                                  (!zone ? ' zone-badge--undefined' : '') +
                                  (zone && /^LIV/i.test(zone)
                                    ? ' zone-badge--external'
                                    : '')
                                }
                                onClick={() => setZoneEditing(o)}
                                title="Changer la zone"
                              >
                                {zone ? (
                                  /^LIV/i.test(zone) ? (
                                    'Externe'
                                  ) : (
                                    <>
                                      <ZoneFlag code={zoneCode(zone)} />
                                      {zone}
                                    </>
                                  )
                                ) : (
                                  'Non défini'
                                )}
                              </button>
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              {o.shippingAddress?.city ? (
                                <button
                                  type="button"
                                  className="reception-meta__chip reception-meta__chip--button"
                                  onClick={() => setAddressViewing(o)}
                                  title="Voir l'adresse sur la carte"
                                >
                                  <span className="reception-meta__emoji">📍</span>
                                  {o.shippingAddress.city}
                                </button>
                              ) : (
                                <span className="reception-table__muted">—</span>
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              {customerName(o.customer) ? (
                                o.customer?.adminUrl ? (
                                  <a
                                    href={o.customer.adminUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="reception-meta__chip reception-meta__chip--client reception-meta__chip--link"
                                    title="Ouvrir la fiche client dans Shopify"
                                  >
                                    <span className="reception-meta__emoji">👤</span>
                                    {customerName(o.customer)}
                                  </a>
                                ) : (
                                  <span className="reception-meta__chip reception-meta__chip--client">
                                    <span className="reception-meta__emoji">👤</span>
                                    {customerName(o.customer)}
                                  </span>
                                )
                              ) : (
                                <span className="reception-table__muted">—</span>
                              )}
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-meta" rowSpan={span}>
                              <span className="reception-meta__chip reception-meta__chip--wait">
                                <span className="reception-meta__emoji">⏱️</span>
                                {daysSince(o.createdAt)} j
                              </span>
                            </td>
                          )}
                          {isFirst && (
                            <td className="reception-date" rowSpan={span}>
                              {formatDate(o.createdAt)}
                            </td>
                          )}
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      </div>

      <ZoneModal
        open={!!zoneEditing}
        currentZone={zoneEditing ? extractZone(zoneEditing) : null}
        customerId={zoneEditing?.customer?.id || null}
        customerName={
          zoneEditing ? customerName(zoneEditing.customer) : null
        }
        address={zoneEditing?.shippingAddress || null}
        orderId={zoneEditing?.id || null}
        orderName={zoneEditing?.name || null}
        onClose={() => setZoneEditing(null)}
        onChanged={() => load()}
      />

      <AddressModal
        open={!!addressViewing}
        address={addressViewing?.shippingAddress || null}
        customerName={
          addressViewing ? customerName(addressViewing.customer) : null
        }
        orderName={addressViewing?.name || null}
        onClose={() => setAddressViewing(null)}
      />

      <StockAdjustModal
        open={adjustItems !== null}
        items={adjustItems || []}
        orderCount={selectedOrders.length}
        onClose={() => setAdjustItems(null)}
        onConfirm={applyStockAdjust}
      />
    </div>
  )
}
