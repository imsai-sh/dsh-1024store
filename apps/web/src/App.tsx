import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { InstallConsole } from './components/InstallConsole'
import { AboutPage as CommunityAboutPage } from './community/pages/AboutPage'
import { FeedPage as CommunityFeedPage } from './community/pages/FeedPage'
import { ThreadPage as CommunityThreadPage } from './community/pages/ThreadPage'
import { UserPage as CommunityUserPage } from './community/pages/UserPage'
import { CommunityLayout } from './community/components/CommunityLayout'
import { SessionProvider } from './community/lib/session'
import { AccountPage } from './pages/AccountPage'
import { ApiDocsPage } from './pages/ApiDocsPage'
import { CatalogPage } from './pages/CatalogPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PackagePage } from './pages/PackagePage'

function LegacyCatalogRedirect() {
  const { hash, search } = useLocation()
  return <Navigate to={`/plugins${search}${hash}`} replace />
}

function LegacyPackageRedirect() {
  const { owner = '', '*': rest = '' } = useParams()
  const { hash, search } = useLocation()
  // Splat, so a monorepo subdirectory path survives the redirect.
  const tail = rest.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const target = tail.length === 0
    ? `/plugins/${encodeURIComponent(owner)}`
    : `/plugins/${encodeURIComponent(owner)}/${tail}`
  return <Navigate to={`${target}${search}${hash}`} replace />
}

export function App() {
  return (
    <Routes>
      {/* The embedded store bypasses AppShell; the install console must ride
          along here too or an embedded install has no visible progress. */}
      <Route path="/embed/store" element={<><CatalogPage view="catalog" /><InstallConsole /></>} />
      <Route element={<AppShell />}>
        <Route index element={<CatalogPage view="rankings" />} />
        <Route path="/plugins" element={<CatalogPage view="catalog" />} />
        <Route path="/rankings" element={<CatalogPage view="rankings" />} />
        <Route path="/plugins/:owner/*" element={<PackagePage />} />
        <Route path="/docs/api" element={<ApiDocsPage />} />
        {/* One section of the site, not a separate app. SessionProvider wraps
            only this subtree: the catalog has no use for a viewer, and fetching
            one on every page load would be a request nobody reads. */}
        <Route path="/community" element={<SessionProvider><CommunityLayout /></SessionProvider>}>
          <Route index element={<CommunityFeedPage />} />
          <Route path="p/:id" element={<CommunityThreadPage />} />
          <Route path="u/:login" element={<CommunityUserPage />} />
          <Route path="about" element={<CommunityAboutPage />} />
        </Route>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/plugin" element={<LegacyCatalogRedirect />} />
        <Route path="/plugin/:owner/*" element={<LegacyPackageRedirect />} />
        <Route path="/packages" element={<LegacyCatalogRedirect />} />
        <Route path="/packages/:owner/*" element={<LegacyPackageRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
