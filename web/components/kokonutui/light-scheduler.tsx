  // Real-time 24h clock updated every second
  const [nowStr, setNowStr] = useState<string>("--:--:--")
  const [nowMinutes, setNowMinutes] = useState<number>(0)
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      setNowStr(`${hh}:${mm}:${ss}`)
      setNowMinutes(d.getHours() * 60 + d.getMinutes())
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Clock, Lightbulb, LightbulbOff } from "lucide-react"
import { io, Socket } from "socket.io-client"
import { useToast } from "@/components/ui/use-toast"

type DeviceLight = {
  name: string
  state: boolean
  on?: string
  off?: string
  scheduleEnabled?: boolean
  pin?: number
}

// All status updates are driven by WebSocket 'status' events. No HTTP fallback.

export default function LightScheduler() {
  const [lights, setLights] = useState<Record<string, DeviceLight>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [form, setForm] = useState({ name: "", pin: 19, on: "18:00", off: "23:00", scheduleEnabled: false })
  const [busy, setBusy] = useState<string | null>(null)
  const { toast } = useToast()

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
            pin: typeof l.pin === 'number' ? l.pin : undefined,
          }
        })
        setLights(next)
      }
    }
    const onConnect = () => {
      wsConnectedRef.current = true
      setWsConnected(true)
      // Ask for current status on connect
      try { socket.emit("cmd", { action: "get_status" }) } catch {}
    }
    const onDisconnect = () => {
      wsConnectedRef.current = false
      setWsConnected(false)
    }
    const onError = () => {
      // noop; rely purely on ws
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    socket.on("status", onStatus)
    socket.on("cmd_ack", (ack: any) => {
      // Show feedback
      if (ack && ack.ok) {
        toast({ title: "Success", description: "Command applied." })
      } else if (ack && ack.error) {
        const map: Record<string, string> = {
          invalid_add_light: "Add light failed: invalid name or pin.",
          pin_in_use: "This pin is already used by another light.",
          pin_time_conflict: "Schedule overlaps with another light using the same pin.",
          invalid_delete_light: "Delete light failed: invalid name.",
        }
        toast({ title: "Failed", description: map[ack.error] || "Command failed.", variant: "destructive" as any })
      }
    })

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onError)
      socket.off("status", onStatus)
      socket.off("cmd_ack")
      socket.close()
      socketRef.current = null
    }
  }, [])

  const setLightField = (id: string, field: keyof DeviceLight, value: any) => {
    setLights((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  // Note: Power toggle removed from Light Scheduling per request

  const toggleAll = () => {
    const someOn = Object.values(lights).some((l) => l.state)
    const next = !someOn
    // optimistic update for all entries
    setLights((prev) => {
      const copy: Record<string, DeviceLight> = {}
      for (const [k, v] of Object.entries(prev)) copy[k] = { ...v, state: next }
      return copy
    })
    socketRef.current?.emit("cmd", { action: "set", target: "all", state: next })
  }

  const saveSchedule = async (id: string) => {
    const L = lights[id]
    if (!L) return
    if (!L.scheduleEnabled) {
      toast({ title: "Schedule is disabled", description: "Enable the schedule switch to activate these times.", variant: "destructive" as any })
      return
    }
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
      // Ask for status to reflect immediate device-side application
      try { socketRef.current?.emit("cmd", { action: "get_status" }) } catch {}
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

  const someOn = entries.some((l) => l.state)

  // PIN usage helpers for Add Light form
  const allowedPins = [19, 21, 22, 23]
  const usedPins = new Set<number>(entries.map((l) => (typeof l.pin === 'number' ? l.pin : -1)).filter((p) => p !== -1))
  const availablePins = allowedPins.filter((p) => !usedPins.has(p))

  // If current form.pin is already used, auto-adjust to first available
  useEffect(() => {
    if (usedPins.has(form.pin)) {
      const first = availablePins[0]
      if (first !== undefined) setForm((f) => ({ ...f, pin: first }))
    }
  }, [entries.length])

  return (
    <div className="w-full space-y-3">
      {/* WS status and realtime 24h clock */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>WS: {wsConnected ? <span className="text-green-600">connected</span> : <span className="text-red-600">disconnected</span>}</div>
        <div>Time: <span className="font-mono">{nowStr}</span></div>
      </div>
      {/* Header with summary and Toggle All */}
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {entries.filter((l) => l.state).length} of {entries.length} lights on
        </span>
        <Button variant="outline" size="sm" onClick={toggleAll} className="text-xs bg-transparent">
          {someOn ? "Turn All Off" : "Turn All On"}
        </Button>
      </div>
      {entries.length === 0 && (
        <div className="text-sm text-muted-foreground">No lights found. Add one below.</div>
      )}

      {entries.map((l) => (
        <Card key={l.name} className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {l.state ? (
                <Lightbulb className="w-4 h-4 text-yellow-400" />
              ) : (
                <LightbulbOff className="w-4 h-4 text-muted-foreground" />
              )}
              <div className="font-medium">{prettyLabel(l.name)}</div>
              {typeof l.pin === 'number' && (
                <span className="text-xs text-muted-foreground">(PIN {l.pin})</span>
              )}
              {/* In-schedule badge */}
              {l.scheduleEnabled && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${isInSchedule(l, nowMinutes) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {isInSchedule(l, nowMinutes) ? 'In schedule' : 'Out of schedule'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs">On</Label>
                <Input type="time" step={60} inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="HH:MM" className="h-8 w-28" value={l.on || "00:00"} onChange={(e) => setLightField(l.name, "on", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Off</Label>
                <Input type="time" step={60} inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="HH:MM" className="h-8 w-28" value={l.off || "00:00"} onChange={(e) => setLightField(l.name, "off", e.target.value)} />
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
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" placeholder="e.g., kitchen" disabled={availablePins.length === 0} />
            </div>
            <div>
              <Label className="text-xs">Pin</Label>
              <select
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                disabled={availablePins.length === 0}
              >
                <option value={19} disabled={usedPins.has(19)}>19{usedPins.has(19) ? " (used)" : ""}</option>
                <option value={21} disabled={usedPins.has(21)}>21{usedPins.has(21) ? " (used)" : ""}</option>
                <option value={22} disabled={usedPins.has(22)}>22{usedPins.has(22) ? " (used)" : ""}</option>
                <option value={23} disabled={usedPins.has(23)}>23{usedPins.has(23) ? " (used)" : ""}</option>
              </select>
              {usedPins.has(form.pin) && (
                <div className="text-[11px] text-red-500 mt-1">This PIN is already used. Please choose another.</div>
              )}
            </div>
            <div>
              <Label className="text-xs">On</Label>
              <Input type="time" step={60} inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="HH:MM" value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} className="h-9" disabled={availablePins.length === 0} />
            </div>
            <div>
              <Label className="text-xs">Off</Label>
              <Input type="time" step={60} inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="HH:MM" value={form.off} onChange={(e) => setForm({ ...form, off: e.target.value })} className="h-9" disabled={availablePins.length === 0} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Schedule</Label>
              <Switch checked={form.scheduleEnabled} onCheckedChange={(v) => setForm({ ...form, scheduleEnabled: v })} disabled={availablePins.length === 0} />
            </div>
          </div>
          <div>
            <Button size="sm" onClick={addLight} disabled={busy === "add" || !form.name.trim() || availablePins.length === 0 || usedPins.has(form.pin)}> {busy === "add" ? "Adding..." : "Add"} </Button>
            {availablePins.length === 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">All GPIO pins (19, 21, 22, 23) are in use. Remove a light to add a new one.</div>
            )}
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
