import { NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { OrganizationList } from './pages/OrganizationList'

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '0.5rem 0.75rem',
  textDecoration: 'none',
  color: isActive ? '#3454d1' : '#1a1a1a',
  fontWeight: isActive ? 700 : 400,
})

function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '960px', margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Sobae Ops Console</h2>
        <nav style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <NavLink to="/" end style={navLinkStyle}>
            ダッシュボード
          </NavLink>
          <NavLink to="/organizations" style={navLinkStyle}>
            事業所一覧
          </NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/organizations" element={<OrganizationList />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
