import { NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { OrganizationList } from './pages/OrganizationList'
import { OrganizationDetail } from './pages/OrganizationDetail'
import { Onboarding } from './pages/Onboarding'
import { Login } from './pages/Login'
import { AcceptInvite } from './pages/AcceptInvite'
import { InviteStaff } from './pages/InviteStaff'
import { RequireAuth } from './components/RequireAuth'
import { useAuth } from './hooks/useAuth'
import { InstallPrompt } from './install/InstallPrompt'

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm ${isActive ? 'font-semibold text-white' : 'text-slate-400 hover:text-slate-200'}`

function Header() {
  const { session, signOut } = useAuth()

  return (
    <header className="bg-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <h2 className="m-0 text-lg font-medium text-white">Sobae Ops Console</h2>
        {session && (
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span>{session.user.email}</span>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded border border-slate-600 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
            >
              ログアウト
            </button>
          </div>
        )}
      </div>
      {session && (
        <nav className="mx-auto flex max-w-5xl gap-1 px-6 pb-2">
          <NavLink to="/" end className={navLinkClassName}>
            ダッシュボード
          </NavLink>
          <NavLink to="/organizations" className={navLinkClassName}>
            事業所一覧
          </NavLink>
          <NavLink to="/onboarding" className={navLinkClassName}>
            新規契約登録
          </NavLink>
          <NavLink to="/staff/invite" className={navLinkClassName}>
            スタッフ招待
          </NavLink>
        </nav>
      )}
    </header>
  )
}

function App() {
  return (
    <div className="min-h-svh bg-slate-50">
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-6">
        <InstallPrompt />

        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/organizations" element={<OrganizationList />} />
            <Route path="/organizations/:id" element={<OrganizationDetail />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/staff/invite" element={<InviteStaff />} />
          </Route>
        </Routes>
      </main>
    </div>
  )
}

export default App
