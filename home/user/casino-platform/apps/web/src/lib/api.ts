import axios from 'axios'

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1',
  withCredentials: true,
})

let accessToken: string | null = null
export const setAccessToken = (t: string | null) => { accessToken = t }

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let refreshing = false
let queue: Array<() => void> = []

api.interceptors.response.use(
  r => r,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/')) {
      if (refreshing) {
        await new Promise<void>(res => queue.push(res))
        return api(original)
      }
      original._retry = true
      refreshing = true
      try {
        const { data } = await axios.post(
          (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1') + '/auth/refresh',
          {},
          { withCredentials: true }
        )
        const newToken = data?.data?.accessToken || data?.accessToken
        if (newToken) setAccessToken(newToken)
        queue.forEach(fn => fn()); queue = []
        return api(original)
      } catch (e) {
        setAccessToken(null)
        queue = []
        throw e
      } finally { refreshing = false }
    }
    throw error
  }
)

export const apiGet = async <T>(url: string, params?: any): Promise<T> => {
  const r = await api.get(url, { params })
  return (r.data?.data ?? r.data) as T
}
export const apiPost = async <T>(url: string, body?: any): Promise<T> => {
  const r = await api.post(url, body)
  return (r.data?.data ?? r.data) as T
}
