import { NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { OrganizationList } from './pages/OrganizationList'
import { OrganizationDetail } from './pages/OrganizationDetail'
import { Onboarding } from './pages/Onboarding'
import { Login } from './pages/Login'
import { RequireAuth } from './components/RequireAuth'
import { useAuth } from './hooks/useAuth'

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '0.5rem 0.75rem',
  textDecoration: 'none',
  color: isActive ? '#3454d1' : '#1a1a1a',
  fontWeight: isActive ? 700 : 400,
})

function Header() {
  const { session, signOut } = useAuth()

  return (
    <header style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Sobae Ops Console</h2>
        {session && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
            <span>{session.user.email}</span>
            <button type="button" onClick={() => signOut()} style={{ padding: '0.3rem 0.6rem' }}>
              ログアウト
            </button>
          </div>
        )}
      </div>
      {session && (
        <nav style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <NavLink to="/" end style={navLinkStyle}>
            ダッシュボード
          </NavLink>
          <NavLink to="/organizations" style={navLinkStyle}>
            事業所一覧
          </NavLink>
          <NavLink to="/onboarding" style={navLinkStyle}>
            新規契約登録
          </NavLink>
        </nav>
      )}
    </header>
  )
}

function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '960px', margin: '0 auto', padding: '1.5rem' }}>
      <Header />

      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/organizations" element={<OrganizationList />} />
            <Route path="/organizations/:id" element={<OrganizationDetail />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Route>
        </Routes>
      </main>
    </div>
  )
}

export default App
