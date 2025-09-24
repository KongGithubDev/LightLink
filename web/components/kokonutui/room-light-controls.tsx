"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Lightbulb, LightbulbOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { io, Socket } from "socket.io-client"

interface UILight {
  id: string // device name (e.g., "kitchen")
  label: string // pretty label
  isOn: boolean
  pin?: number
}

interface RoomLightControlsProps {
  className?: string
}

export default function RoomLightControls({ className }: RoomLightControlsProps) {
  const [lights, setLights] = useState<Record<string, UILight>>({})
  // Optimistic state for PIN toggles so UI reflects immediately before device status comes back
  const [pinOptimistic, setPinOptimistic] = useState<Record<number, boolean>>({})
  // Latest pin state reported by device (payload.pins)
  const [pinReport, setPinReport] = useState<Record<number, boolean>>({})
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)

  const pushLog = (msg: string) => {
    const t = new Date().toLocaleTimeString()
    // Send to console instead of UI list
    // eslint-disable-next-line no-console
    console.log(`[${t}] ${msg}`)
  }

  useEffect(() => {
    // attempt websocket
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket

    const onStatus = (payload: any) => {
      let next: Record<string, UILight> | null = null
      if (Array.isArray(payload?.lights)) {
        next = {}
        ;(payload.lights as any[]).forEach((l) => {
          const id = String(l.name)
          const rawPin: any = (l as any).pin
          const parsed = typeof rawPin === 'number' ? rawPin : Number(rawPin)
          const pin = Number.isFinite(parsed) ? parsed : undefined
          next![id] = { id, label: prettyLabel(id), isOn: !!l.state, pin }
        })
      }
      // If we also have pins, use them to override room isOn when pin matches
      if (Array.isArray(payload?.pins)) {
        const map: Record<number, boolean> = {}
        ;(payload.pins as any[]).forEach((po) => {
          const pin = Number(po?.pin)
          const state = !!po?.state
          if ([19,21,22,23].includes(pin)) map[pin] = state
        })
        setPinReport(map)
        // apply to lights map if available
        if (next) {
          for (const L of Object.values(next)) {
            if (typeof L.pin === 'number' && (L.pin in map)) {
              L.isOn = !!map[L.pin]
            }
          }
        } else {
          // No lights array in this event; update existing lights in-place
          setLights((prev) => {
            const copy: Record<string, UILight> = {}
            for (const [k, v] of Object.entries(prev)) {
              const newVal = { ...v }
              if (typeof v.pin === 'number' && (v.pin in map)) newVal.isOn = !!map[v.pin]
              copy[k] = newVal
            }
            return copy
          })
        }
        // Clear optimistic for pins that we have authoritative report on
        setPinOptimistic((prev) => {
          if (!prev) return prev
          const copy = { ...prev }
          for (const k of Object.keys(copy)) {
            const p = Number(k)
            if (p in map) delete copy[p]
          }
          return copy
        })
      }
      // Overlay optimistic PIN values to room cards so UI stays consistent while waiting for pins
      if (next) {
        setLights((prev) => {
          const merged: Record<string, UILight> = {}
          for (const [k, v] of Object.entries(next!)) {
            const L = { ...v }
            if (typeof L.pin === 'number' && (L.pin in pinOptimistic)) {
              L.isOn = !!pinOptimistic[L.pin]
            }
            merged[k] = L
          }
          return merged
        })
      }
    }
    const onConnect = () => {
      wsConnectedRef.current = true
      pushLog("ws connected")
      // Ask device(s) for current status via server broadcast
      try { socket.emit("cmd", { action: "get_status" }) } catch {}
    }
    const onDisconnect = () => {
      wsConnectedRef.current = false
      pushLog("ws disconnected")
    }
    const onError = () => {
      if (!wsConnectedRef.current) pushLog("ws error")
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    socket.on("status", onStatus)
    socket.on("cmd_ack", () => {})

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

  const toggleLight = async (id: string, newState: boolean) => {
    setLights((prev) => ({ ...prev, [id]: { ...prev[id], isOn: newState } }))
    socketRef.current?.emit("cmd", { action: "set", target: id, state: newState })
    pushLog(`cmd(set) ${id} -> ${newState}`)
  }

  const toggleAll = async () => {
    const someOn = Object.values(lights).some((l) => l.isOn)
    const next = !someOn // if any is on -> turn all off; if none on (including empty) -> turn all on
    socketRef.current?.emit("cmd", { action: "set", target: "all", state: next })
    pushLog(`cmd(set) all -> ${next}`)
  }

  // --- PIN controls ---
  const allowedPins = [19, 21, 22, 23]
  const pinState: Record<number, boolean> = {}
  for (const p of allowedPins) pinState[p] = false
  // Prefer device-reported pins state if present
  for (const p of allowedPins) {
    if (p in pinReport) pinState[p] = !!pinReport[p]
  }
  // Fallback to derived from lights if no pinReport
  if (Object.keys(pinReport).length === 0) {
    for (const L of Object.values(lights)) {
      if (typeof L.pin === 'number' && allowedPins.includes(L.pin)) {
        pinState[L.pin] = pinState[L.pin] || L.isOn
      }
    }
  }
  // Apply optimistic overrides
  for (const p of allowedPins) {
    if (p in pinOptimistic) pinState[p] = !!pinOptimistic[p]
  }
  const togglePin = (pin: number, next: boolean) => {
    // optimistic update
    setPinOptimistic((m) => ({ ...m, [pin]: next }))
    // update room tiles that share this pin immediately
    setLights((prev) => {
      const copy: Record<string, UILight> = {}
      for (const [k, v] of Object.entries(prev)) {
        const L = { ...v }
        if (typeof L.pin === 'number' && L.pin === pin) {
          L.isOn = next
        }
        copy[k] = L
      }
      return copy
    })
    socketRef.current?.emit("cmd", { action: "set_pin", pin, state: next })
    pushLog(`cmd(set_pin) ${pin} -> ${next}`)
  }

  const onCount = Object.values(lights).filter((l) => l.isOn).length
  const total = Object.keys(lights).length
  const someOn = onCount > 0

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-muted-foreground">
          {onCount} of {total} lights on
        </span>
        <Button variant="outline" size="sm" onClick={toggleAll} className="text-xs bg-transparent">
          {someOn ? "Turn All Off" : "Turn All On"}
        </Button>
      </div>

      <div className="space-y-3">
        {/* PIN controls */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="font-medium text-sm">GPIO Pins</div>
            <div className="flex items-center gap-4">
              {allowedPins.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">PIN {p}</span>
                  <Switch checked={!!pinState[p]} onCheckedChange={(v) => togglePin(p, v)} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        {Object.values(lights).map((room) => (
          <Card key={room.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {room.isOn ? (
                  <Lightbulb className="w-4 h-4 text-yellow-400" />
                ) : (
                  <LightbulbOff className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="font-medium text-sm">{room.label}</span>
                {typeof room.pin === 'number' && (
                  <span className="text-xs text-muted-foreground">(PIN {room.pin})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={room.isOn} onCheckedChange={(v) => toggleLight(room.id, v)} />
              </div>
            </div>
          </Card>
        ))}
        {total === 0 && (
          <Card className="p-4 text-sm text-muted-foreground">Waiting for device status...</Card>
        )}
      </div>

      
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
