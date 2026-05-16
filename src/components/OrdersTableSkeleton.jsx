export default function OrdersTableSkeleton({
  columns = 9,
  rows = 6,
  hasImageCol = true,
  hasActionCol = false,
}) {
  return (
    <div className="reception-table-wrap">
      <table className="reception-table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="skeleton-row">
              {Array.from({ length: columns }).map((_, c) => {
                const isAction = hasActionCol && c === 0
                const isImage =
                  hasImageCol && c === (hasActionCol ? 1 : 0)
                const isProduit =
                  c === (hasActionCol ? 2 : 1)
                let inner = <span className="skeleton-bar" />
                if (isAction) inner = <span className="skeleton-action" />
                else if (isImage) inner = <span className="skeleton-image" />
                else if (isProduit)
                  inner = (
                    <span className="skeleton-product">
                      <span className="skeleton-qty" />
                      <span className="skeleton-bar skeleton-bar--wide" />
                    </span>
                  )
                return <td key={c}>{inner}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
