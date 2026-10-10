import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowUpRight, Menu, X } from 'lucide-react'

const navigation = [['/', 'Home'], ['/marketplace', 'Marketplace'], ['/pricing', 'Pricing'], ['/support', 'Support']]
export function SiteLayout() {
  const [open, setOpen] = useState(false)
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    const label = pathname === '/' ? 'Digital products & services' : pathname.slice(1).replaceAll('-', ' ')
    document.title = `LOGSPOLL | ${label}`
  }, [pathname, search])
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="container header-inner">
      <Link to="/" className="brand" aria-label="LOGSPOLL home">LOGS<span>POLL</span><i /></Link>
      <nav className="desktop-nav" aria-label="Main navigation">{navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav>
      <div className="header-actions"><Link className="login-link" to="/login">Log in</Link><Link className="button button-small" to="/signup">Sign up <ArrowUpRight size={16} /></Link>
        <button className="icon-button menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
    </div>{open && <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">{navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}<Link to="/login" onClick={() => setOpen(false)}>Log in</Link></nav>}</header>
    <main id="main" tabIndex={-1}><Outlet /></main>
    <footer className="site-footer"><div className="container footer-top"><div><Link className="brand" to="/">LOGS<span>POLL</span><i /></Link><p>Digital tools. Everyday possibilities.</p></div><nav aria-label="Footer navigation"><Link to="/marketplace">Marketplace</Link><Link to="/about">About us</Link><Link to="/support">Support</Link><Link to="/faq">FAQ</Link></nav></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} LOGSPOLL</span><span>Digital products & services</span></div></footer>
  </>
}
