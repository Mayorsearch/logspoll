import { Globe2, Users, Phone, Mail, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export const categories = [
  { slug: 'vpn-services', name: 'VPN Services', description: 'Private connection tools', Icon: Globe2, tone: 'blue' },
  { slug: 'social-media-services', name: 'Social Media Services', description: 'Business & management tools', Icon: Users, tone: 'purple' },
  { slug: 'virtual-numbers', name: 'Virtual Numbers', description: 'Business communication', Icon: Phone, tone: 'green' },
  { slug: 'us-emails', name: 'US Emails', description: 'Business email services', Icon: Mail, tone: 'orange' },
]
export function Categories() {
  return <div className="category-grid">{categories.map(({ slug, name, description, Icon, tone }) => <Link to={`/marketplace?category=${slug}`} className="category-card" key={slug}><span className={`category-icon ${tone}`}><Icon size={24} /></span><ArrowUpRight className="category-arrow" size={18} /><h3>{name}</h3><p>{description}</p></Link>)}</div>
}
