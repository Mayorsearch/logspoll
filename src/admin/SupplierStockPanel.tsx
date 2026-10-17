import { useCallback, useEffect, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

type InventoryRow = {
  externalId: string
  supplierId: string
  supplierReportedStock: number | null
  verifiedSellableStock: number
  reviewStatus: 'requires_review' | 'eligible_for_review'
  supplierStockSnapshotAt: number | null
  sellableStockCheckedAt: number | null
}

type InventoryResponse = {
  inventory: InventoryRow[]
  summary: {
    total: number
    reportedPositive: number | null
    sellablePositive: number | null
    snapshotCompletedAt: number | null
  } | null
  page: number
  pageSize: number
  disclaimer: string
}

const readableDate = (value: number | null) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not available'
}

export default function SupplierStockPanel() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InventoryResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (targetPage: number) => {
    setBusy(true)
    setError('')
    try {
      const result = await cloudflareRequest<InventoryResponse>(
        `/api/admin/catalog?inventory=1&page=${targetPage}`
      )
      setData(result)
      setPage(targetPage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Private inventory unavailable.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh(1)
    }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

  const total = data?.summary?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize || 50)))

  return <section aria-label="Private supplier inventory" style={{ marginTop: 24 }}>
    <h3>Supplier inventory</h3>
    <p>YoungPG quantities from the last completed snapshot are shown separately from stock currently verified for sale.</p>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <div><strong>{total}</strong> snapshot listings</div>
      <div><strong>{data?.summary?.reportedPositive ?? '—'}</strong> reporting positive stock</div>
      <div><strong>{data?.summary?.sellablePositive ?? '—'}</strong> with verified sellable stock</div>
      <button type="button" className="cf-btn secondary" disabled={busy}
        onClick={() => void refresh(page)}>{busy ? 'Checking…' : 'Refresh display'}</button>
    </div>
    <p style={{ fontSize: 12 }}>
      Snapshot completed: {readableDate(data?.summary?.snapshotCompletedAt ?? null)}.
      Refreshing this display does not recheck YoungPG live inventory.
    </p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th scope="col">Supplier item ID</th>
            <th scope="col">Supplier reported</th>
            <th scope="col">Verified sellable</th>
            <th scope="col">Review</th>
          </tr></thead>
          <tbody>
            {data.inventory.map(item =>
              <tr key={`${item.supplierId}:${item.externalId}`}>
                <td>{item.externalId}</td>
                <td>{item.supplierReportedStock ?? 'Unknown'}</td>
                <td>{item.verifiedSellableStock}</td>
                <td>{item.reviewStatus === 'requires_review' ? 'Review required' : 'No review block'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="cf-btn secondary" disabled={busy || page <= 1}
          onClick={() => void refresh(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" className="cf-btn secondary" disabled={busy || page >= pages}
          onClick={() => void refresh(page + 1)}>Next</button>
      </div>
      <p style={{ fontSize: 12 }}>{data.disclaimer}</p>
    </>}
  </section>
}
