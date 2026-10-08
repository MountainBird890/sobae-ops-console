import { useEffect, useId, useState } from 'react'

// Confirmation dialog for destructive lifecycle operations (SEC-004): the operator has to type the target's
// name again before the button becomes active. The backend re-checks the name, so this is a guard against
// mis-clicks, not the only line of defence.
export function ConfirmActionModal({
  title,
  targetKind,
  targetName,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string
  targetKind: '法人' | '事業所'
  targetName: string
  description: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (input: { confirmName: string; reason: string }) => Promise<void>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const matches = typed.trim() === targetName.trim()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  async function submit() {
    if (!matches || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm({ confirmName: typed, reason: reason.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 id={titleId} className="m-0 text-lg font-medium text-slate-900">
          {title}
        </h2>

        <p className={`mt-3 rounded border p-3 text-sm ${danger ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {description}
        </p>

        <p className="mb-1 mt-4 text-sm text-slate-700">
          対象の{targetKind}：<strong className="text-slate-900">{targetName}</strong>
        </p>

        <label className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
          実行するには、{targetKind}名をもう一度入力してください
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={submitting}
            className="block w-full box-border rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-invalid={typed !== '' && !matches}
          />
        </label>
        {typed !== '' && !matches && <p className="m-0 mt-1 text-xs text-red-600">{targetKind}名が一致しません</p>}

        <label className="mt-4 flex flex-col gap-1 text-sm text-slate-700">
          理由（任意。監査ログに記録されます）
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            rows={2}
            maxLength={500}
            className="block w-full box-border rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!matches || submitting}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {submitting ? '実行中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
