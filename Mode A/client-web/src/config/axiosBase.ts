import axios from 'axios'

export const axiosBase = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

axiosBase.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error?.response?.data?.error ?? error?.message ?? 'Something went wrong'
    const wrapped = new Error(message) as Error & { status?: number }
    wrapped.status = error?.response?.status
    return Promise.reject(wrapped)
  },
)
