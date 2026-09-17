import { useState, type FormEvent } from 'react'
import { ApiError, inviteStaff } from '../lib/api'

export function InviteStaff() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setInvitedEmail(null)
    try {
      const { user } = await inviteStaff(email)
      setInvitedEmail(user.email)
      setEmail('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '招待に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: '320px' }}>
      <h1 style={{ fontSize: '1.25rem' }}>スタッフを招待</h1>
      <p style={{ fontSize: '0.85rem', color: '#555' }}>
        SOBAE社内スタッフのメールアドレス宛に招待メールを送信します。本人がメール内のリンクからパスワードを設定します。
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          メールアドレス
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem' }}
          />
        </label>

        {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}
        {invitedEmail && <p role="status" style={{ color: '#1a7a1a' }}>{invitedEmail} 宛に招待メールを送信しました。</p>}

        <button type="submit" disabled={submitting} style={{ padding: '0.5rem' }}>
          {submitting ? '送信中…' : '招待メールを送信'}
        </button>
      </form>
    </div>
  )
}
