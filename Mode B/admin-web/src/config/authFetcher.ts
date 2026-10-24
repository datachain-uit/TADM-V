import type { AxiosRequestConfig } from 'axios'
import { axiosBase } from './axiosBase'

export async function authFetcher<T = unknown>(path: string, options: AxiosRequestConfig = {}): Promise<T> {
  const response = await axiosBase.request<T>({ ...options, url: path })
  return response.data
}
