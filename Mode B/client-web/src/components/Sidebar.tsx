import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/protected/dashboard', label: 'Overview' },
  { to: '/protected/dashboard/keys', label: 'My keys' },
  { to: '/protected/dashboard/withdrawal', label: 'Withdraw scholarship' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">TADM-V · Student · Mode B · on-chain</div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/protected/dashboard'}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
