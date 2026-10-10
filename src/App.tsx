import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { Home } from './pages/Home'
import { Marketplace } from './pages/Marketplace'
import { Pricing } from './pages/Pricing'
import { Information, Unavailable, NotFound } from './pages/Information'

export default function App() {
  return <BrowserRouter><Routes><Route element={<SiteLayout />}>
    <Route index element={<Home />} />
    <Route path="marketplace" element={<Marketplace />} />
    <Route path="categories" element={<Marketplace />} />
    <Route path="pricing" element={<Pricing />} />
    <Route path="about" element={<Information kind="about" />} />
    <Route path="support" element={<Information kind="support" />} />
    <Route path="faq" element={<Information kind="faq" />} />
    <Route path="login" element={<Unavailable title="Account sign in" />} />
    <Route path="signup" element={<Unavailable title="Create your account" />} />
    <Route path="*" element={<NotFound />} />
  </Route></Routes></BrowserRouter>
}
