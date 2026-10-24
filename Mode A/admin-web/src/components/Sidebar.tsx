import { NavLink } from 'react-router-dom'
import type { StaffRole } from '@/types/auth'

interface NavItem {
  to: string
  label: string
  roles: StaffRole[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/protected/dashboard', label: 'Overview', roles: ['STUDENT_AFFAIRS', 'FINANCE'] },
  { to: '/protected/dashboard/students', label: 'Students', roles: ['STUDENT_AFFAIRS', 'FINANCE'] },
  { to: '/protected/dashboard/scholarships', label: 'Issue scholarships · approve root', roles: ['STUDENT_AFFAIRS'] },
  { to: '/protected/dashboard/pools', label: 'Scholarship pools', roles: ['STUDENT_AFFAIRS', 'FINANCE'] },
  { to: '/protected/dashboard/withdrawals', label: 'Withdrawal requests', roles: ['STUDENT_AFFAIRS', 'FINANCE'] },
]

export default function Sidebar({ role }: { role: StaffRole }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">TADM-V · Mode A · off-chain</div>
      <nav>
        {NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => (
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
