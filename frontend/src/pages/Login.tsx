import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Login() {
  const { configured, session, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) setError(error)
    setSubmitting(false)
  }

  return (
    <div style={{ maxWidth: '320px', margin: '4rem auto' }}>
      <h1 style={{ fontSize: '1.25rem' }}>Sobae Ops Console</h1>

      {!configured && (
        <p role="alert" style={{ color: '#b3261e' }}>
          Supabaseが未設定のため、ログインできません。管理者に環境変数の設定を確認してください。
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          メールアドレス
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!configured}
            style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem' }}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!configured}
            style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem' }}
          />
        </label>

        {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}

        <button type="submit" disabled={!configured || submitting} style={{ padding: '0.5rem' }}>
          {submitting ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  )
}
