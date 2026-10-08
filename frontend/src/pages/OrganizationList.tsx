import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, fetchOrganizations, type Organization, type OrganizationStatus } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { LifecycleActions } from '../components/LifecycleActions'

const STATUS_OPTIONS: { value: OrganizationStatus | ''; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'active', label: '有効' },
  { value: 'suspended', label: '利用停止中' },
  { value: 'terminated', label: '契約終了' },
]

const DASH = '—'

export function OrganizationList() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [status, setStatus] = useState<OrganizationStatus | ''>('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchOrganizations({ status: status || undefined, q: q || undefined })
      .then((data) => {
        if (!cancelled) setOrganizations(data.organizations)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : '法人一覧の取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [status, q, reloadKey])

  return (
    <div>
      <h1 className="text-2xl font-medium text-slate-900">法人一覧</h1>

      <div className="mb-4 flex gap-3">
        <input
          type="search"
          placeholder="法人名・管理番号で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OrganizationStatus | '')}
          className="rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-slate-500">読み込み中…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && organizations.length === 0 && <p className="text-slate-500">該当する法人がありません。</p>}

      {organizations.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="p-2 font-medium">法人名</th>
                <th className="p-2 font-medium">管理番号</th>
                <th className="p-2 font-medium">ステータス</th>
                <th className="p-2 font-medium">契約開始日</th>
                <th className="p-2 font-medium">契約終了日</th>
                <th className="p-2 font-medium">停止日</th>
                <th className="p-2 font-medium">再開日</th>
                <th className="p-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="p-2">
                    <Link to={`/organizations/${org.id}`} className="text-blue-600 hover:underline">
                      {org.name}
                    </Link>
                  </td>
                  <td className="p-2">{org.management_number ?? DASH}</td>
                  <td className="p-2">
                    <StatusBadge status={org.status} />
                  </td>
                  <td className="p-2 whitespace-nowrap">{org.contract_start_date ?? DASH}</td>
                  <td className="p-2 whitespace-nowrap">{org.contract_end_date ?? DASH}</td>
                  <td className="p-2 whitespace-nowrap">{org.last_suspended_at ?? DASH}</td>
                  <td className="p-2 whitespace-nowrap">{org.last_reactivated_at ?? DASH}</td>
                  <td className="p-2">
                    <LifecycleActions kind="organization" id={org.id} name={org.name} status={org.status} onDone={() => setReloadKey((k) => k + 1)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
