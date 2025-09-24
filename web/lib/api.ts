export const TOKEN = process.env.LIGHTLINK_TOKEN || process.env.NEXT_PUBLIC_LIGHTLINK_TOKEN || "devtoken"

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`API ${path} ${res.status}`)
  return res
}

export async function getStatus() {
  const res = await apiFetch("/api/status", { method: "GET" })
  return res.json()
}

export async function sendCommand(cmd: any) {
  const res = await apiFetch("/api/cmd", { method: "POST", body: JSON.stringify(cmd) })
  return res.json()
}

// Lights CRUD
export type LightDoc = {
  name: string
  pin: number
  on?: string
  off?: string
  scheduleEnabled?: boolean
}

export async function listLights(): Promise<{ lights: LightDoc[] }> {
  const res = await apiFetch("/api/lights", { method: "GET" })
  return res.json()
}

export async function createLight(doc: LightDoc) {
  const res = await apiFetch("/api/lights", { method: "POST", body: JSON.stringify(doc) })
  return res.json()
}

export async function updateLight(name: string, patch: Partial<LightDoc>) {
  const res = await apiFetch(`/api/lights/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
  return res.json()
}

export async function deleteLight(name: string) {
  const res = await apiFetch(`/api/lights/${encodeURIComponent(name)}`, { method: "DELETE" })
  return res.json()
}
