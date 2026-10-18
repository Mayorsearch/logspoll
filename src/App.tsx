import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { Home } from './pages/Home'
import { Marketplace } from './pages/Marketplace'
import { Pricing } from './pages/Pricing'
import { CategoryPage, ContactPage, PolicyPage, ProductDetails } from './pages/ExtraPages'
import { Information, NotFound } from './pages/Information'
import { lazy, Suspense } from 'react'
import { ApiDocs } from './pages/ApiDocs'

const Admin = lazy(() => import('./admin/Admin'))
import { CartProvider } from './lib/cart'
import { CurrencyProvider } from './lib/currency'
import { Cart } from './pages/Cart'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute, AdminGate } from './auth/ProtectedRoute'
import { AuthPage, AuthCallback, RecoveryRedirect } from './pages/Auth'
import { DashboardLayout, CustomerRecords, Profile, AccountSettings } from './pages/Dashboard'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CurrencyProvider>
          <CartProvider>
            <RecoveryRedirect />
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route element={<AdminGate />}>
                  <Route path="admin/:section?/:tab?" element={
                    <Suspense fallback={<div className="container py-8 text-center text-slate-400">Loading administrator portal...</div>}>
                      <Admin />
                    </Suspense>
                  } />
                </Route>
              </Route>

              <Route element={<SiteLayout />}>
                <Route index element={<Home />} />

                <Route path="marketplace" element={<Marketplace />} />
                <Route path="products" element={<Navigate to="/marketplace" replace />} />
                <Route path="catalog" element={<Navigate to="/marketplace" replace />} />
                <Route path="private-catalog" element={<Navigate to="/marketplace" replace />} />
                <Route path="products/:slug" element={<ProductDetails />} />
                <Route path="docs" element={<ApiDocs />} />
                <Route path="api-docs" element={<Navigate to="/docs" replace />} />

                <Route path="categories" element={<CategoryPage />} />
                <Route path="categories/:slug" element={<CategoryPage />} />

                <Route path="contact" element={<ContactPage />} />
                <Route path="privacy" element={<PolicyPage privacy />} />
                <Route path="terms" element={<PolicyPage />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="about" element={<Information kind="about" />} />
                <Route path="support" element={<Information kind="support" />} />
                <Route path="faq" element={<Information kind="faq" />} />
                <Route path="login" element={<AuthPage key="login" mode="login" />} />
                <Route path="signup" element={<AuthPage key="signup" mode="signup" />} />
                <Route path="verify-email" element={<AuthPage key="verify" mode="verify" />} />
                <Route path="forgot-password" element={<AuthPage key="forgot" mode="forgot" />} />
                <Route path="reset-password" element={<AuthPage key="reset" mode="reset" />} />
                <Route path="auth/callback" element={<AuthCallback />} />
                <Route path="admin/login" element={<AuthPage key="admin" mode="admin" />} />

                <Route element={<ProtectedRoute />}>
                  <Route path="cart" element={<Cart />} />
                  <Route path="checkout" element={<Cart checkout />} />
                  <Route path="dashboard" element={<DashboardLayout />}>
                    <Route index element={<CustomerRecords key="overview" mode="overview" />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="orders" element={<CustomerRecords key="orders" mode="orders" />} />
                    <Route path="purchases" element={<CustomerRecords key="purchases" mode="purchases" />} />
                    <Route path="downloads" element={<CustomerRecords key="downloads" mode="purchases" />} />
                    <Route path="favorites" element={<CustomerRecords key="favorites" mode="favorites" />} />
                    <Route path="support" element={<CustomerRecords key="support" mode="support" />} />
                    <Route path="transactions" element={<CustomerRecords key="transactions" mode="transactions" />} />
                    <Route path="settings" element={<AccountSettings />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </CartProvider>
        </CurrencyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
