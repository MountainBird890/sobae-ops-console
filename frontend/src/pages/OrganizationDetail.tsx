import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, fetchOrganization, fetchOrganizationOffices, type Office, type Organization } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { LifecycleActions } from '../components/LifecycleActions'

const DASH = '—'

// 法人の詳細と、その法人が管理する事業所の一覧。法人・事業所それぞれに、利用停止・利用再開（と、法人のみ契約終了）の操作がある。
export function OrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [offices, setOffices] = useState<Office[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([fetchOrganization(id), fetchOrganizationOffices(id)])
      .then(([org, off]) => {
        if (cancelled) return
        setOrganization(org.organization)
        setOffices(off.offices)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError('法人が見つかりませんでした')
        } else {
          setError(err instanceof ApiError ? err.message : '法人情報の取得に失敗しました')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  return (
    <div>
      <p>
        <Link to="/organizations" className="text-blue-600 hover:underline">
          ← 法人一覧に戻る
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
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-2xl font-medium text-slate-900">{organization.name}</h1>
            <StatusBadge status={organization.status} />
            <LifecycleActions kind="organization" id={organization.id} name={organization.name} status={organization.status} onDone={reload} />
          </div>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">管理番号</dt>
            <dd className="m-0">{organization.management_number ?? DASH}</dd>
            <dt className="text-slate-500">契約開始日</dt>
            <dd className="m-0">{organization.contract_start_date ?? DASH}</dd>
            <dt className="text-slate-500">契約終了日</dt>
            <dd className="m-0">{organization.contract_end_date ?? DASH}</dd>
            <dt className="text-slate-500">停止日</dt>
            <dd className="m-0">{organization.last_suspended_at ?? DASH}</dd>
            <dt className="text-slate-500">再開日</dt>
            <dd className="m-0">{organization.last_reactivated_at ?? DASH}</dd>
          </dl>

          <h2 className="mb-2 mt-8 text-lg font-medium text-slate-900">事業所</h2>
          {offices.length === 0 ? (
            <p className="text-slate-500">この法人に登録されている事業所はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="p-2 font-medium">事業所名</th>
                    <th className="p-2 font-medium">事業所コード</th>
                    <th className="p-2 font-medium">ステータス</th>
                    <th className="p-2 font-medium">契約開始日</th>
                    <th className="p-2 font-medium">契約終了日</th>
                    <th className="p-2 font-medium">停止日</th>
                    <th className="p-2 font-medium">再開日</th>
                    <th className="p-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {offices.map((office) => (
                    <tr key={office.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                      <td className="p-2">
                        <Link to={`/offices/${office.id}`} className="text-blue-600 hover:underline">
                          {office.name}
                        </Link>
                      </td>
                      <td className="p-2">{office.code}</td>
                      <td className="p-2">
                        <StatusBadge status={office.display_status} />
                        {office.organization_status !== 'active' && office.status !== office.display_status && (
                          <div className="mt-1 text-xs text-slate-500">法人の状態を表示</div>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">{office.contract_start_date ?? DASH}</td>
                      <td className="p-2 whitespace-nowrap">{office.contract_end_date ?? DASH}</td>
                      <td className="p-2 whitespace-nowrap">{office.last_suspended_at ?? DASH}</td>
                      <td className="p-2 whitespace-nowrap">{office.last_reactivated_at ?? DASH}</td>
                      <td className="p-2">
                        <LifecycleActions kind="office" id={office.id} name={office.name} status={office.status} onDone={reload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
