import {NavLink} from 'react-router-dom'
import {House,ShoppingBag,ShoppingCart,Receipt,UserRound} from 'lucide-react'
export function MobileBottomNavigation(){
 const links=[['/','Home',House],['/marketplace','Shop',ShoppingBag],['/cart','Cart',ShoppingCart],['/dashboard/orders','Orders',Receipt],['/dashboard/profile','Profile',UserRound]] as const
 return <nav className="mobile-bottom-navigation" aria-label="Quick navigation">{links.map(([to,label,Icon])=><NavLink key={label} to={to} end={to==='/'}><Icon size={21}/><span>{label}</span></NavLink>)}</nav>
}
