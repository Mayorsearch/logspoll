import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { MobileBottomNavigation } from './MobileBottomNavigation'
import { FloatingChatWidget } from './FloatingChatWidget'
import { cloudflareAuth } from '../lib/cloudflare-auth'
import { useAuth } from '../auth/AuthProvider'
import { useCart } from '../lib/cart'
import { CurrencySelector } from '../lib/currency'
import { 
  Menu, X, Package, Info, Send, House, History, 
  ShoppingCart, LifeBuoy, Sun, Moon, BookOpen, Heart, User, LogOut,
  ShieldCheck, LayoutDashboard
} from 'lucide-react'

export function SiteLayout() {
  const { session } = useAuth()
  const { items } = useCart()
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLElement>(null)
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('logspoll-site-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.siteTheme = theme
    try {
      localStorage.setItem('logspoll-site-theme', theme)
    } catch {
      // Storage may be unavailable
    }
  }, [theme])

  useEffect(() => {
    if (!open) return
    const trigger = toggle.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    menu.current?.querySelector<HTMLElement>('button,a')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        event.preventDefault()
      }
      if (event.key === 'Tab') {
        const items = menu.current?.querySelectorAll<HTMLElement>('a,button:not(:disabled)')
        if (!items?.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', key)
      trigger?.focus()
    }
  }, [open])

  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await cloudflareAuth('sign-out', {})
      window.location.assign('/login')
    } catch {
      setError('Sign out failed. Please retry.')
      setSigningOut(false)
    }
  }

  const { pathname, search } = useLocation()
  const isHome = pathname === '/'

  const navigation = session
    ? ([
        ['/dashboard', 'Dashboard', LayoutDashboard],
        ['/marketplace', 'Shop', Package],
        ['/dashboard/orders', 'Orders', History],
        ['/docs', 'API Docs', BookOpen],
      ] as const)
    : ([
        ['/', 'Home', House],
        ['/marketplace', 'Products', Package],
        ['/pricing', 'Pricing', Info],
        ['/support', 'Support', LifeBuoy],
      ] as const)

  useEffect(() => {
    window.scrollTo(0, 0)
    const label = pathname === '/' ? 'Digital products & services' : pathname.slice(1).replaceAll('-', ' ')
    document.title = `LOGSPOLL | ${label}`
  }, [pathname, search])

  return (
    <div className={`site-shell${isHome ? ' homepage-layout' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      
      {/* Sticky Header */}
      <header className={`site-header${isHome ? ' homepage-header' : ''}`}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="LOGSPOLL home">
            Logs<span>Poll</span><i />
          </Link>
          
          <nav className="desktop-nav" aria-label="Main navigation">
            {navigation.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end={to === '/' || to === '/dashboard'}>
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            {/* Multi-Currency Selector */}
            <CurrencySelector />

            {/* Dark / Light Mode Switcher */}
            <button 
              className="icon-button theme-toggle" 
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>

            {/* Shopping Cart */}
            <Link className="icon-button header-cart" to="/cart" aria-label="View cart" title="View cart">
              <ShoppingCart size={20} />
              {totalItems > 0 && <span className="cart-badge">{totalItems}</span>}
            </Link>

            {/* User CTA for Desktop */}
            {session ? (
              <Link to="/dashboard" className="header-user-btn" aria-label="Go to Dashboard">
                <User size={16} />
                <span className="desktop-only">{((session.user.user_metadata?.full_name as string) || (session.user.user_metadata?.name as string) || session.user.email?.split('@')[0] || 'Account').split(' ')[0]}</span>
              </Link>
            ) : (
              <div className="desktop-auth-buttons">
                <Link to="/signup" className="button button-signup-pill">Sign Up</Link>
              </div>
            )}

            {/* Mobile Hamburger Button */}
            <button 
              ref={toggle} 
              className="icon-button menu-toggle" 
              aria-label={open ? 'Close navigation' : 'Open navigation'} 
              aria-expanded={open} 
              aria-controls="mobile-nav" 
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Expandable Mobile Menu Drawer (Requirement 8) */}
        {open && (
          <>
            <button 
              className="mobile-menu-backdrop" 
              aria-label="Close navigation" 
              onClick={() => setOpen(false)}
            />
            <nav 
              ref={menu} 
              id="mobile-nav" 
              className="mobile-nav" 
              role="dialog" 
              aria-modal="true" 
              aria-label="Mobile navigation"
            >
              <div className="mobile-menu-heading">
                <div className="mobile-brand">
                  Logs<span>Poll</span>
                </div>
                <button 
                  className="icon-button" 
                  aria-label="Close navigation" 
                  onClick={() => setOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mobile-menu-controls">
                <CurrencySelector />
                <button 
                  className="button button-outline button-small mobile-theme-btn"
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                >
                  {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                  <span>{theme === 'light' ? 'Dark' : 'Light'} Mode</span>
                </button>
              </div>

              <div className="mobile-nav-links">
                <Link to="/marketplace" onClick={() => setOpen(false)}>
                  <Package size={18} /> Shop
                </Link>
                <Link to="/marketplace?favorites=1" onClick={() => setOpen(false)}>
                  <Heart size={18} /> Favorites
                </Link>
                <Link to="/docs" onClick={() => setOpen(false)}>
                  <BookOpen size={18} /> API Documentation
                </Link>
                <Link to="/about" onClick={() => setOpen(false)}>
                  <Info size={18} /> About Us
                </Link>
                <Link to="/contact" onClick={() => setOpen(false)}>
                  <Send size={18} /> Contact
                </Link>
                <Link to="/support" onClick={() => setOpen(false)}>
                  <LifeBuoy size={18} /> Support
                </Link>
              </div>

              <div className="mobile-menu-auth">
                {session ? (
                  <>
                    <Link to="/dashboard" className="mobile-auth-primary" onClick={() => setOpen(false)}>
                      <LayoutDashboard size={18} /> Dashboard
                    </Link>
                    <Link to="/dashboard/orders" onClick={() => setOpen(false)}>
                      <History size={18} /> Orders
                    </Link>
                    <Link to="/dashboard/profile" onClick={() => setOpen(false)}>
                      <User size={18} /> Profile
                    </Link>
                    <button 
                      className="mobile-logout" 
                      disabled={signingOut} 
                      onClick={() => void logout()}
                    >
                      <LogOut size={18} /> {signingOut ? 'Signing out…' : 'Log out'}
                    </button>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="mobile-login-link" onClick={() => setOpen(false)}>
                      Log In
                    </Link>
                    <Link to="/signup" className="button mobile-auth-primary" onClick={() => setOpen(false)}>
                      Create Account
                    </Link>
                  </>
                )}
              </div>

              {error && <p role="alert" className="form-error">{error}</p>}

              <div className="mobile-menu-footer">
                <small>Built by SwiftNova Labs</small>
              </div>
            </nav>
          </>
        )}
      </header>

      {/* Main Page Content */}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      {/* Fixed Mobile Bottom Navigation (Requirement 7) */}
      <MobileBottomNavigation onOpenMenu={() => setOpen(true)} />

      {/* Multi-Column Footer (Requirement 2H) */}
      <footer className="site-footer">
        <div className="container footer-top">
          <div className="footer-col footer-brand-col">
            <Link className="brand" to="/">
              Logs<span>Poll</span><i />
            </Link>
            <p>
              Your premier digital essentials marketplace. Explore verified digital products, accounts, 
              and tools organized across three high-performance logical server tiers.
            </p>
            <div className="footer-badge">
              <ShieldCheck size={16} /> <span>Verified &amp; Protected Platform</span>
            </div>
          </div>

          <nav className="footer-col" aria-label="Explore marketplace">
            <h3>EXPLORE</h3>
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/marketplace?server=1">Server 1 Products</Link>
            <Link to="/marketplace?server=2">Server 2 Products</Link>
            <Link to="/marketplace?server=3">Server 3 Products</Link>
            <Link to="/marketplace?favorites=1">Favorites</Link>
          </nav>

          <nav className="footer-col" aria-label="Categories">
            <h3>CATEGORIES</h3>
            <Link to="/marketplace?main_category=facebook">Facebook</Link>
            <Link to="/marketplace?main_category=instagram">Instagram</Link>
            <Link to="/marketplace?main_category=twitter">Twitter / X</Link>
            <Link to="/marketplace?main_category=tiktok">TikTok</Link>
            <Link to="/marketplace?main_category=gmail">Gmail</Link>
            <Link to="/marketplace?main_category=vpn">VPN</Link>
          </nav>

          <nav className="footer-col" aria-label="Developer and Support">
            <h3>DEVELOPERS &amp; SUPPORT</h3>
            <Link to="/docs">API Documentation</Link>
            <Link to="/about">About Us</Link>
            <Link to="/support">Contact Support</Link>
            <Link to="/contact">Contact Us</Link>
            <Link to="/faq">Frequently Asked Questions</Link>
          </nav>

          <nav className="footer-col" aria-label="Account and Legal">
            <h3>ACCOUNT &amp; LEGAL</h3>
            <Link to={session ? '/dashboard' : '/login'}>{session ? 'Customer Dashboard' : 'Login'}</Link>
            <Link to={session ? '/dashboard/profile' : '/signup'}>{session ? 'Account Profile' : 'Create Account'}</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/pricing">Pricing &amp; Rates</Link>
          </nav>
        </div>

        <div className="container footer-bottom">
          <span>&copy; 2026 LogsPoll. All rights reserved.</span>
          <span>Digital Essentials &amp; Verified Accounts</span>
        </div>

        <div className="container footer-credit">
          <small>Built by SwiftNova Labs</small>
        </div>
      </footer>

      {/* Floating Live Support Widget matching PadiLogs bubble */}
      <FloatingChatWidget />
    </div>
  )
}
