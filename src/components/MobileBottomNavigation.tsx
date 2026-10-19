import { NavLink } from 'react-router-dom'
import { 
  House, 
  ShoppingBag, 
  UserPlus, 
  LogIn, 
  Menu, 
  LayoutDashboard, 
  Wallet,
  Receipt, 
  UserRound 
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'

interface MobileBottomNavigationProps {
  onOpenMenu?: () => void
}

export function MobileBottomNavigation({ onOpenMenu }: MobileBottomNavigationProps) {
  const { session } = useAuth()

  if (!session) {
    // Visitor Navigation
    return (
      <nav className="mobile-bottom-navigation" aria-label="Mobile quick navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <House size={20} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/marketplace" className={({ isActive }) => (isActive ? 'active' : '')}>
          <ShoppingBag size={20} />
          <span>Shop</span>
        </NavLink>
        <NavLink to="/signup" className={({ isActive }) => (isActive ? 'active' : '')}>
          <UserPlus size={20} />
          <span>Register</span>
        </NavLink>
        <NavLink to="/login" className={({ isActive }) => (isActive ? 'active' : '')}>
          <LogIn size={20} />
          <span>Login</span>
        </NavLink>
        <button 
          type="button" 
          onClick={onOpenMenu} 
          aria-label="Open mobile menu"
          className="mobile-bottom-menu-btn"
        >
          <Menu size={20} />
          <span>Menu</span>
        </button>
      </nav>
    )
  }

  // Authenticated Customer Navigation (5 aligned items: Dashboard | Shop | Wallet | Orders | Profile)
  return (
    <nav className="mobile-bottom-navigation" aria-label="Customer quick navigation">
      <NavLink to="/dashboard" end className={({ isActive }) => (isActive ? 'active' : '')}>
        <LayoutDashboard size={20} />
        <span>Dashboard</span>
      </NavLink>
      <NavLink to="/marketplace" className={({ isActive }) => (isActive ? 'active' : '')}>
        <ShoppingBag size={20} />
        <span>Shop</span>
      </NavLink>
      <NavLink to="/dashboard/wallet" className={({ isActive }) => (isActive ? 'active' : '')}>
        <Wallet size={20} />
        <span>Wallet</span>
      </NavLink>
      <NavLink to="/dashboard/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
        <Receipt size={20} />
        <span>Orders</span>
      </NavLink>
      <NavLink to="/dashboard/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
        <UserRound size={20} />
        <span>Profile</span>
      </NavLink>
    </nav>
  )
}
