import { Link, Route, Routes } from 'react-router'
import { EmptyState, Page } from '../components/ui'
import { CodeStep } from '../features/auth/CodeStep'
import { EmailStep } from '../features/auth/EmailStep'
import { NameStep } from '../features/auth/NameStep'
import { PhoneStep } from '../features/auth/PhoneStep'
import { RecoverStep } from '../features/auth/RecoverStep'
import { More } from '../features/more/More'
import { Dashboard } from '../features/shops/Dashboard'
import { ShopDetail } from '../features/shops/ShopDetail'
import { ShopList } from '../features/shops/ShopList'
import { Support } from '../features/support/Support'
import { AdminGate, FinishingProfile, SignedIn, SignedOutOnly } from './guards'
import { Bare, Shell } from './Shell'

export function App() {
  return (
    <Routes>
      <Route element={<Bare />}>
        <Route element={<SignedOutOnly />}>
          <Route path="/signin" element={<PhoneStep />} />
          <Route path="/signin/code" element={<CodeStep />} />
          <Route path="/signin/recover" element={<RecoverStep />} />
        </Route>
        <Route element={<FinishingProfile />}>
          <Route path="/welcome/email" element={<EmailStep />} />
          <Route path="/welcome/name" element={<NameStep />} />
        </Route>
      </Route>

      <Route element={<SignedIn />}>
        <Route element={<AdminGate />}>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="/shops" element={<ShopList />} />
            <Route path="/shops/:id" element={<ShopDetail />} />
            <Route path="/support" element={<Support />} />
            <Route path="/more" element={<More />} />
            <Route
              path="*"
              element={
                <Page back="/">
                  <EmptyState
                    title="Page not found"
                    action={
                      <Link to="/" className="text-brand underline">
                        Go to the dashboard
                      </Link>
                    }
                  />
                </Page>
              }
            />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
