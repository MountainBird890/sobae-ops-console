import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, fetchOffice, type Office } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { LifecycleActions } from '../components/LifecycleActions'

const DASH = '—'

export function OfficeDetail() {
  const { id } = useParams<{ id: string }>()
  const [office, setOffice] = useState<Office | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchOffice(id)
      .then((data) => {
        if (!cancelled) setOffice(data.office)
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
  }, [id, reloadKey])

  const organizationBlocksLogin = office !== null && office.organization_status !== 'active'

  return (
    <div>
      {office ? (
        <p>
          <Link to={`/organizations/${office.organization_id}`} className="text-blue-600 hover:underline">
            ← {office.organization_name ?? '法人'}に戻る
          </Link>
        </p>
      ) : (
        <p>
          <Link to="/organizations" className="text-blue-600 hover:underline">
            ← 法人一覧に戻る
          </Link>
        </p>
      )}

      {loading && <p className="text-slate-500">読み込み中…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {office && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-2xl font-medium text-slate-900">{office.name}</h1>
            <StatusBadge status={office.display_status} />
            <LifecycleActions kind="office" id={office.id} name={office.name} status={office.status} onDone={() => setReloadKey((k) => k + 1)} />
          </div>

          {organizationBlocksLogin && (
            <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              この事業所が所属する法人は「{office.organization_status === 'suspended' ? '利用停止中' : office.organization_status === 'terminated' ? '契約終了' : '要確認'}」です。
              法人の状態が優先されるため、この事業所のスタッフは、法人側が解除されるまでログインできません（事業所自身の状態：
              {office.status === 'active' ? '有効' : office.status === 'suspended' ? '利用停止中' : office.status === 'terminated' ? '契約終了' : '要確認'}）。
            </p>
          )}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">所属法人</dt>
            <dd className="m-0">{office.organization_name ?? DASH}</dd>
            <dt className="text-slate-500">事業所コード</dt>
            <dd className="m-0">{office.code}</dd>
            <dt className="text-slate-500">郵便番号</dt>
            <dd className="m-0">{office.postal_code ?? DASH}</dd>
            <dt className="text-slate-500">住所</dt>
            <dd className="m-0">{office.address ?? DASH}</dd>
            <dt className="text-slate-500">電話番号</dt>
            <dd className="m-0">{office.phone ?? DASH}</dd>
            <dt className="text-slate-500">FAX番号</dt>
            <dd className="m-0">{office.fax ?? DASH}</dd>
            <dt className="text-slate-500">メールアドレス</dt>
            <dd className="m-0">{office.email ?? DASH}</dd>
            <dt className="text-slate-500">契約開始日</dt>
            <dd className="m-0">{office.contract_start_date ?? DASH}</dd>
            <dt className="text-slate-500">契約終了日</dt>
            <dd className="m-0">{office.contract_end_date ?? DASH}</dd>
            <dt className="text-slate-500">停止日</dt>
            <dd className="m-0">{office.last_suspended_at ?? DASH}</dd>
            <dt className="text-slate-500">再開日</dt>
            <dd className="m-0">{office.last_reactivated_at ?? DASH}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}
