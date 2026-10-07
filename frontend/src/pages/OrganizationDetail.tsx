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
        <Link to="/organizations" className="text-blue-600 hover:underline">
          ← 事業所一覧に戻る
        </Link>
      </p>

      {loading && <p className="text-slate-500">読み込み中…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {organization && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h1 className="m-0 text-2xl font-medium text-slate-900">{organization.name}</h1>
            <StatusBadge status={organization.status} />
          </div>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {FIELDS.map(({ key, label }) => (
              <div key={key} className="contents">
                <dt className="text-slate-500">{label}</dt>
                <dd className="m-0">{organization[key] ?? '—'}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-sm text-slate-500">
            事業所・サービス情報や操作履歴、利用停止/再開/終了操作は未実装です。
          </p>
        </div>
      )}
    </div>
  )
}
