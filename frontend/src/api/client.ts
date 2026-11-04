// Thin fetch wrapper - proxied through Vite's dev server to backend.main:app
// (see vite.config.ts). No auth: carries forward the existing LAN/Tailscale
// -only trust boundary (see the vessel-ops-multiuser-hosting project memory).

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

// Carries the parsed FastAPI error `detail` (when the response was JSON)
// so a specific call site can branch on it - e.g. a 409 from POST /items
// includes {item_id, item_name} for the existing catalog row.
export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(message: string, status: number, detail: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: unknown = undefined
    try {
      detail = JSON.parse(text).detail
    } catch {
      // not JSON - leave detail undefined, message still carries the raw text
    }
    throw new ApiError(`${method} ${path} failed: ${res.status} ${text}`, res.status, detail)
  }
  return res.json() as Promise<T>
}
