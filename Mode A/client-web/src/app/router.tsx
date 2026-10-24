import { Navigate, createBrowserRouter } from 'react-router-dom'
import ChangePasswordPage from './auth/change-password/page'
import LoginPage from './auth/login/page'
import ProtectedLayout from './protected/layout'
import DashboardPage from './protected/dashboard/page'
import KeysPage from './protected/dashboard/keys/page'
import WithdrawalPage from './protected/dashboard/withdrawal/page'

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/protected/dashboard" replace /> },
  { path: '/auth/login', element: <LoginPage /> },
  { path: '/auth/change-password', element: <ChangePasswordPage /> },
  {
    path: '/protected',
    element: <ProtectedLayout />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'dashboard/keys', element: <KeysPage /> },
      { path: 'dashboard/withdrawal', element: <WithdrawalPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/protected/dashboard" replace /> },
])
