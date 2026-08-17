import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <p>読み込み中…</p>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
