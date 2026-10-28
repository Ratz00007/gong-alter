'use client'
// AMBER — typed API client honoring the Ch. 5 error envelope.
export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public status?: number) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let code = 'INTERNAL'
    let message = res.statusText
    let details: unknown
    try {
      const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } }
      if (body.error) {
        code = body.error.code
        message = body.error.message
        details = body.error.details
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(code, message, details, res.status)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
