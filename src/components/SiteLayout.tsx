import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { MobileBottomNavigation } from './MobileBottomNavigation'
import { cloudflareAuth } from '../lib/cloudflare-auth'
import { useAuth } from '../auth/AuthProvider'
import { Menu, X, Package, Info, Send, House, History, List, Settings, ShoppingCart, LifeBuoy, Sun, Moon } from 'lucide-react'

export function SiteLayout() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [error,setError]=useState(''),[signingOut,setSigningOut]=useState(false)
  const toggle=useRef<HTMLButtonElement>(null),menu=useRef<HTMLElement>(null)
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('logspoll-site-theme')==='dark'?'dark':'light'}catch{return 'light'}})
  useEffect(()=>{document.documentElement.dataset.siteTheme=theme;try{localStorage.setItem('logspoll-site-theme',theme)}catch{/* Storage may be unavailable. */}},[theme])
  useEffect(()=>{if(!open)return;const trigger=toggle.current;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';menu.current?.querySelector<HTMLElement>('button,a')?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);event.preventDefault()}if(event.key==='Tab'){const items=menu.current?.querySelectorAll<HTMLElement>('a,button:not(:disabled)');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);trigger?.focus()}},[open])
  async function logout(){if(signingOut)return;setSigningOut(true);try{await cloudflareAuth('sign-out',{});window.location.assign('/login')}catch{setError('Sign out failed. Please retry.');setSigningOut(false)}}
  const { pathname, search } = useLocation()
  const isHome = pathname === '/'
  const navigation = session ? [['/dashboard', 'Overview', House], ['/marketplace', 'Shop', Package], ['/dashboard/purchases', 'Purchases', History], ['/dashboard/transactions', 'Transactions', List], ['/dashboard/profile', 'Profile', Settings]] as const : isHome ? [['/', 'Home', House], ['/marketplace', 'Products', Package], ['/pricing', 'Pricing', Info], ['/support', 'Support', LifeBuoy]] as const : [['/marketplace', 'Shop', Package], ['/about', 'About Us', Info], ['/contact', 'Contact', Send]] as const
  useEffect(() => {
    window.scrollTo(0, 0)
    const label = pathname === '/' ? 'Digital products & services' : pathname.slice(1).replaceAll('-', ' ')
    document.title = `LOGSPOLL | ${label}`
  }, [pathname, search])
  return <div className={`site-shell${isHome?' homepage-layout':''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`site-header${isHome ? ' homepage-header' : ''}`}><div className="container header-inner">
      <Link to="/" className="brand" aria-label="LOGSPOLL home">Logs<span>Poll</span><i /></Link>
      <nav className="desktop-nav" aria-label="Main navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end><Icon size={20} />{label}</NavLink>)}</nav>
      <div className="header-actions"><label className="currency-selector"><span className="sr-only">Currency</span><select aria-label="Currency"><option value="NGN">NGN ₦</option></select></label><button className="icon-button theme-toggle" aria-label={`Switch to ${theme==='light'?'dark':'light'} mode`} onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button><Link className="icon-button header-cart" to="/cart" aria-label="View cart"><ShoppingCart size={21}/></Link><button ref={toggle} className="icon-button menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
    </div>{open && <><button className="mobile-menu-backdrop" aria-label="Close navigation" onClick={()=>setOpen(false)}/><nav ref={menu} id="mobile-nav" className="mobile-nav" role="dialog" aria-modal="true" aria-label="Mobile navigation"><div className="mobile-menu-heading"><strong>Explore LogsPoll</strong><button className="icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X/></button></div>{navigation.map(([to,label,Icon])=><NavLink key={to} to={to} end onClick={()=>setOpen(false)}><Icon size={19}/>{label}</NavLink>)}<Link to="/marketplace?favorites=1" onClick={()=>setOpen(false)}>Favorites</Link>{[['/about','About'],['/contact','Contact'],['/support','Support']].map(([to,label])=><Link key={to} to={to} onClick={()=>setOpen(false)}>{label}</Link>)}{session?<button className="mobile-logout" disabled={signingOut} onClick={()=>void logout()}>{signingOut?'Signing out…':'Log out'}</button>:<><Link to="/login" onClick={()=>setOpen(false)}>Log in</Link><Link to="/signup" onClick={()=>setOpen(false)}>Create account</Link></>}{error&&<p role="alert" className="form-error">{error}</p>}</nav></>}</header>
    <main id="main" tabIndex={-1}><Outlet /></main>
    <MobileBottomNavigation/>
    <footer className="site-footer"><div className="container footer-top"><div><Link className="brand" to="/">Logs<span>Poll</span><i /></Link><p>Your private digital goods marketplace. Premium digital accounts, subscriptions, and services — all in one trusted workspace.</p></div><nav aria-label="Shop by category"><h3>CATEGORIES</h3><Link to="/marketplace?main_category=instagram">Instagram</Link><Link to="/marketplace?main_category=facebook">Facebook</Link><Link to="/marketplace?main_category=tiktok">TikTok</Link><Link to="/marketplace?main_category=twitter">Twitter</Link><Link to="/marketplace?main_category=gmail">Gmail</Link><Link to="/marketplace?main_category=vpn">VPN</Link></nav><nav aria-label="Legal and website links"><h3>LEGAL</h3><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Service</Link><Link to="/about">About Us</Link><Link to="/pricing">Pricing</Link></nav><nav aria-label="Support links"><h3>SUPPORT</h3><Link to={session ? '/dashboard' : '/login'}>{session ? 'Dashboard' : 'Log In'}</Link><Link to={session ? '/dashboard/settings' : '/signup'}>{session ? 'Account Settings' : 'Create Account'}</Link><Link to="/marketplace">Marketplace</Link><Link to="/support">Support</Link><Link to="/faq">FAQ</Link><Link to="/contact">Contact</Link></nav></div><div className="container footer-bottom"><span>© 2026 LogsPoll. All rights reserved.</span><span>Digital products &amp; services</span></div><div className="container footer-credit"><small>Built by SwiftNova Labs</small></div></footer>
  </div>
}
