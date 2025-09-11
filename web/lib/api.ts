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
