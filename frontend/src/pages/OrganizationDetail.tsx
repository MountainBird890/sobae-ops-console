import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, fetchOrganization, type Organization } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

const FIELDS: { key: keyof Organization; label: string }[] = [
  { key: 'management_number', label: '管理番号' },
  { key: 'contract_start_date', label: '契約開始日' },
  { key: 'contract_end_date', label: '契約終了日' },
]

export function OrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchOrganization(id)
      .then((data) => {
        if (!cancelled) setOrganization(data.organization)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError('事業所が見つかりませんでした')
        } else {
          setError(err instanceof ApiError ? err.message : '事業所情報の取得に失敗しました')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div>
      <p>
        <Link to="/organizations">← 事業所一覧に戻る</Link>
      </p>

      {loading && <p>読み込み中…</p>}
      {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}

      {organization && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <h1 style={{ margin: 0 }}>{organization.name}</h1>
            <StatusBadge status={organization.status} />
          </div>

          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '1rem', rowGap: '0.5rem' }}>
            {FIELDS.map(({ key, label }) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt style={{ color: '#5b6470' }}>{label}</dt>
                <dd style={{ margin: 0 }}>{organization[key] ?? '-'}</dd>
              </div>
            ))}
          </dl>

          <p style={{ color: '#5b6470', fontSize: '0.85rem', marginTop: '2rem' }}>
            事業所・サービス情報や操作履歴、利用停止/再開/終了操作は未実装です。
          </p>
        </div>
      )}
    </div>
  )
}
