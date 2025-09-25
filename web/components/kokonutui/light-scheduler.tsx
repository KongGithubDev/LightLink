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

// Local 24-hour time input using text, to force 24h format regardless of browser locale
function TimeInput24({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  const norm = (v: string) => {
    // keep only digits and colon, max 5 chars
    let s = v.replace(/[^0-9:]/g, "").slice(0, 5)
    // auto-insert colon when typing 3rd char (e.g., 123 -> 12:3)
    if (/^\d{3}$/.test(s)) s = `${s.slice(0,2)}:${s.slice(2)}`
    // if 4 digits without colon -> insert
    if (/^\d{4}$/.test(s)) s = `${s.slice(0,2)}:${s.slice(2)}`
    return s
  }
  const clampHM = (s: string) => {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(s)
    if (!m) return value
    let hh = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0))
    let mm = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0))
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
  }
  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      pattern="[0-2][0-9]:[0-5][0-9]"
      value={value}
      onChange={(e) => onChange(norm(e.target.value))}
      onBlur={(e) => onChange(clampHM(e.target.value))}
      className={className}
      disabled={disabled}
    />
  )
}

// All status updates are driven by WebSocket 'status' events. No HTTP fallback.

export default function LightScheduler() {
  const [lights, setLights] = useState<Record<string, DeviceLight>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)
  const [form, setForm] = useState({ name: "", pin: 19, on: "18:00", off: "23:00", scheduleEnabled: false })
  const [busy, setBusy] = useState<string | null>(null)
  const { toast } = useToast()

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
      // Ask for current status on connect
      try { socket.emit("cmd", { action: "get_status" }) } catch {}
    }
    const onDisconnect = () => { wsConnectedRef.current = false }
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
      {/* Realtime clock moved to TopNav; WS status removed */}
      {/* Header with summary */}
      <div className="flex justify-between items-center px-1 sm:px-0">
        <span className="text-sm text-muted-foreground">
          {entries.filter((l) => l.state).length} of {entries.length} lights on
        </span>
      </div>
      {entries.length === 0 && (
        <div className="text-sm text-muted-foreground">No lights found. Add one below.</div>
      )}

      {entries.map((l) => (
        <Card key={l.name} className="p-2 sm:p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
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
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-xs">On</Label>
                <TimeInput24 value={l.on || "00:00"} onChange={(v) => setLightField(l.name, "on", v)} disabled={false} className="h-8 w-24 sm:w-28" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Off</Label>
                <TimeInput24 value={l.off || "00:00"} onChange={(v) => setLightField(l.name, "off", v)} disabled={false} className="h-8 w-24 sm:w-28" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Schedule</Label>
                <Switch checked={!!l.scheduleEnabled} onCheckedChange={(v) => setLightField(l.name, "scheduleEnabled", v)} />
              </div>
              <Button size="sm" variant="default" onClick={() => saveSchedule(l.name)} disabled={!!saving[l.name]} className="whitespace-nowrap">
                {saving[l.name] ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => deleteLight(l.name)} disabled={busy === `del:${l.name}`} className="whitespace-nowrap">
                {busy === `del:${l.name}` ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {/* Add Light */}
      <Card className="p-3">
        <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr,auto,auto] gap-2 sm:gap-3 items-center w-full">
          <div>
            <Label className="text-xs">Name</Label>
            <Input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" placeholder="e.g. tester" />
          </div>
          <div>
            <Label className="text-xs">PIN</Label>
            <select className="h-9 w-full bg-background border rounded-md px-2 text-sm" value={form.pin} onChange={(e) => setForm({ ...form, pin: parseInt(e.target.value) })}>
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
            <TimeInput24 value={form.on} onChange={(v) => setForm({ ...form, on: v })} className="h-9 w-28" disabled={availablePins.length === 0} />
          </div>
          <div>
            <Label className="text-xs">Off</Label>
            <TimeInput24 value={form.off} onChange={(v) => setForm({ ...form, off: v })} className="h-9 w-28" disabled={availablePins.length === 0} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Schedule</Label>
            <Switch checked={form.scheduleEnabled} onCheckedChange={(v) => setForm({ ...form, scheduleEnabled: v })} disabled={availablePins.length === 0} />
          </div>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={addLight} disabled={busy === "add" || !form.name.trim() || availablePins.length === 0 || usedPins.has(form.pin)} className="w-full sm:w-auto"> {busy === "add" ? "Adding..." : "Add"} </Button>
          {availablePins.length === 0 && (
            <div className="text-[11px] text-muted-foreground mt-1">All GPIO pins (19, 21, 22, 23) are in use. Remove a light to add a new one.</div>
          )}
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

// Helper: determine if current time is within a light's schedule (24h, supports overnight)
function isInSchedule(l: { on?: string; off?: string }, nowMinutes: number): boolean {
  const parseHM = (s?: string): number | null => {
    if (!s || s.length < 4) return null
    const hh = Math.max(0, Math.min(23, parseInt(s.slice(0, 2), 10)))
    const mm = Math.max(0, Math.min(59, parseInt(s.slice(3, 5), 10)))
    return hh * 60 + mm
  }
  const onM = parseHM(l.on) ?? 0
  const offM = parseHM(l.off) ?? 0
  if (onM === offM) return false
  if (onM < offM) return nowMinutes >= onM && nowMinutes < offM
  // overnight
  return nowMinutes >= onM || nowMinutes < offM
}
