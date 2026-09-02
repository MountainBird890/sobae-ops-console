import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export function AcceptInvite() {
  const { configured, session, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (done) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    setDone(true)
  }

  return (
    <div style={{ maxWidth: '320px', margin: '4rem auto' }}>
      <h1 style={{ fontSize: '1.25rem' }}>パスワードを設定</h1>

      {!configured && (
        <p role="alert" style={{ color: '#b3261e' }}>
          Supabaseが未設定のため、パスワードを設定できません。
        </p>
      )}

      {configured && !loading && !session && (
        <p role="alert" style={{ color: '#b3261e' }}>
          招待リンクが無効か、有効期限が切れています。管理者に再招待を依頼してください。
        </p>
      )}

      {configured && session && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ fontSize: '0.85rem', color: '#555' }}>{session.user.email} としてログインするパスワードを設定してください。</p>
          <label>
            新しいパスワード
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem' }}
            />
          </label>

          {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}

          <button type="submit" disabled={submitting} style={{ padding: '0.5rem' }}>
            {submitting ? '設定中…' : 'パスワードを設定'}
          </button>
        </form>
      )}
    </div>
  )
}
