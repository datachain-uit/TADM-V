import { Navigate, createBrowserRouter } from 'react-router-dom'
import LoginPage from './auth/login/page'
import ProtectedLayout from './protected/layout'
import DashboardPage from './protected/dashboard/page'
import PoolsPage from './protected/dashboard/pools/page'
import ScholarshipsPage from './protected/dashboard/scholarships/page'
import StudentsPage from './protected/dashboard/students/page'
import WithdrawalsPage from './protected/dashboard/withdrawals/page'

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/protected/dashboard" replace /> },
  { path: '/auth/login', element: <LoginPage /> },
  {
    path: '/protected',
    element: <ProtectedLayout />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'dashboard/students', element: <StudentsPage /> },
      { path: 'dashboard/scholarships', element: <ScholarshipsPage /> },
      { path: 'dashboard/pools', element: <PoolsPage /> },
      { path: 'dashboard/withdrawals', element: <WithdrawalsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/protected/dashboard" replace /> },
])
