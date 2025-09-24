"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Clock } from "lucide-react"
import { io, Socket } from "socket.io-client"

type DeviceLight = {
  name: string
  state: boolean
  on?: string
  off?: string
  scheduleEnabled?: boolean
}

export default function LightScheduler() {
  const [lights, setLights] = useState<Record<string, DeviceLight>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: "", pin: 19, on: "18:00", off: "23:00", scheduleEnabled: false })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    // connect websocket
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket
    const onStatus = (payload: any) => {
      if (Array.isArray(payload?.lights)) {
        const next: Record<string, DeviceLight> = {}
        ;(payload.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = {
            name: id,
            state: !!l.state,
            on: l.on,
            off: l.off,
            scheduleEnabled: !!l.scheduleEnabled,
          }
        })
        setLights(next)
      }
    }
    const onConnect = () => {
      wsConnectedRef.current = true
    }
    const onDisconnect = () => {
      wsConnectedRef.current = false
    }
    const onError = () => {
      // noop; rely purely on ws
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    socket.on("status", onStatus)

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onError)
      socket.off("status", onStatus)
      socket.close()
      socketRef.current = null
    }
  }, [])

  const setLightField = (id: string, field: keyof DeviceLight, value: any) => {
    setLights((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const saveSchedule = async (id: string) => {
    const L = lights[id]
    if (!L) return
    setSaving((s) => ({ ...s, [id]: true }))
    try {
      const payload = {
        action: "schedule",
        room: id,
        on: L.on || "00:00",
        off: L.off || "00:00",
        enabled: !!L.scheduleEnabled,
      }
      socketRef.current?.emit("cmd", payload)
    } finally {
      setTimeout(() => setSaving((s) => ({ ...s, [id]: false })), 500)
    }
  }

  const addLight = async () => {
    if (!form.name.trim()) return
    setBusy("add")
    try {
      socketRef.current?.emit("cmd", {
        action: "add_light",
        name: form.name.trim(),
        pin: form.pin,
        on: form.on || "00:00",
        off: form.off || "00:00",
        scheduleEnabled: !!form.scheduleEnabled,
      })
      // device will reload via server broadcast
      setForm({ name: "", pin: 19, on: "18:00", off: "23:00", scheduleEnabled: false })
      setAdding(false)
    } finally {
      setBusy(null)
    }
  }

  const deleteLight = async (name: string) => {
    if (!name) return
    setBusy(`del:${name}`)
    try {
      socketRef.current?.emit("cmd", { action: "delete_light", name })
      // device will reload via server broadcast
    } finally {
      setTimeout(() => setBusy(null), 500)
    }
  }

  const entries = Object.values(lights)

  return (
    <div className="w-full space-y-3">
      {entries.length === 0 && (
        <div className="text-sm text-muted-foreground">No lights found. Add one below.</div>
      )}

      {entries.map((l) => (
        <Card key={l.name} className="p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{prettyLabel(l.name)}</div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs">On</Label>
                <Input type="time" className="h-8 w-28" value={l.on || "00:00"} onChange={(e) => setLightField(l.name, "on", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Off</Label>
                <Input type="time" className="h-8 w-28" value={l.off || "00:00"} onChange={(e) => setLightField(l.name, "off", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Schedule</Label>
                <Switch checked={!!l.scheduleEnabled} onCheckedChange={(v) => setLightField(l.name, "scheduleEnabled", v)} />
              </div>
              <Button size="sm" variant="default" onClick={() => saveSchedule(l.name)} disabled={!!saving[l.name]}>
                {saving[l.name] ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => deleteLight(l.name)} disabled={busy === `del:${l.name}`}>
                {busy === `del:${l.name}` ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <Card className="p-3">
        <div className="flex flex-col gap-3">
          <div className="font-medium">Add Light</div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" placeholder="e.g., kitchen" />
            </div>
            <div>
              <Label className="text-xs">Pin</Label>
              <select
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value={19}>19</option>
                <option value={21}>21</option>
                <option value={22}>22</option>
                <option value={23}>23</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">On</Label>
              <Input type="time" value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Off</Label>
              <Input type="time" value={form.off} onChange={(e) => setForm({ ...form, off: e.target.value })} className="h-9" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Schedule</Label>
              <Switch checked={form.scheduleEnabled} onCheckedChange={(v) => setForm({ ...form, scheduleEnabled: v })} />
            </div>
          </div>
          <div>
            <Button size="sm" onClick={addLight} disabled={busy === "add" || !form.name.trim()}> {busy === "add" ? "Adding..." : "Add"} </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function prettyLabel(id: string) {
  const map: Record<string, string> = {
    kitchen: "Kitchen",
    living: "Living Room",
    bedroom: "Bedroom",
  }
  return map[id] || id
}
