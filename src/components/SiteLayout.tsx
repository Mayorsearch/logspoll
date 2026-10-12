import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Menu, X, Package, Info, Send, House, History, List, Settings, ShoppingCart, LifeBuoy } from 'lucide-react'

export function SiteLayout() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const { pathname, search } = useLocation()
  const isHome = pathname === '/'
  const navigation = session ? [['/dashboard', 'Overview', House], ['/marketplace', 'Shop', Package], ['/dashboard/purchases', 'Purchases', History], ['/dashboard/transactions', 'Transactions', List], ['/dashboard/profile', 'Profile', Settings]] as const : isHome ? [['/', 'Home', House], ['/marketplace', 'Products', Package], ['/pricing', 'Pricing', Info], ['/support', 'Support', LifeBuoy]] as const : [['/marketplace', 'Shop', Package], ['/about', 'About Us', Info], ['/contact', 'Contact', Send]] as const
  useEffect(() => {
    window.scrollTo(0, 0)
    const label = pathname === '/' ? 'Digital products & services' : pathname.slice(1).replaceAll('-', ' ')
    document.title = `LOGSPOLL | ${label}`
  }, [pathname, search])
  return <div className={isHome ? 'homepage-layout' : undefined}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`site-header${isHome ? ' homepage-header' : ''}`}><div className="container header-inner">
      <Link to="/" className="brand" aria-label="LOGSPOLL home">LOGS<span>POLL</span><i /></Link>
      <nav className="desktop-nav" aria-label="Main navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end><Icon size={20} />{label}</NavLink>)}</nav>
      <div className="header-actions">{session ? <><Link className="icon-button" to="/cart" aria-label="View cart"><ShoppingCart size={22} /></Link><Link className="icon-button" to="/support" aria-label="Support"><LifeBuoy size={22} /></Link></> : <><Link className="login-link" to="/login">Log In</Link><Link className="button button-small" to="/signup">{isHome ? 'Sign Up' : 'Register'}</Link></>}
        <button className="icon-button menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
    </div>{open && <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end onClick={() => setOpen(false)}><Icon size={19} />{label}</NavLink>)}<Link to={session ? "/dashboard/settings" : "/login"} onClick={() => setOpen(false)}>{session ? "Account settings" : "Log in"}</Link></nav>}</header>
    <main id="main" tabIndex={-1}><Outlet /></main>
    <footer className="site-footer"><div className="container footer-top"><div><Link className="brand" to="/">LOGS<span>POLL</span><i /></Link><p>Your private digital goods marketplace. Digital products and professional tools for the way you work.</p></div><nav aria-label="Legal and website links"><h3>LEGAL</h3><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Service</Link><Link to="/about">About Us</Link><Link to="/pricing">Pricing</Link></nav><nav aria-label="Account links"><h3>ACCOUNT</h3><Link to={session ? '/dashboard' : '/login'}>{session ? 'Dashboard' : 'Log In'}</Link><Link to={session ? '/dashboard/settings' : '/signup'}>{session ? 'Account Settings' : 'Create Account'}</Link><Link to="/marketplace">Marketplace</Link><Link to="/support">Support</Link><Link to="/faq">FAQ</Link><Link to="/contact">Contact</Link></nav></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} LOGSPOLL. All rights reserved.</span><span>Digital products & services</span></div></footer>
  </div>
}
