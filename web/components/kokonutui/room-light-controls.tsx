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
  const [logLines, setLogLines] = useState<string[]>([])
  const socketRef = useRef<Socket | null>(null)
  const wsConnectedRef = useRef(false)

  const pushLog = (msg: string) => {
    const t = new Date().toLocaleTimeString()
    setLogLines((prev) => [`[${t}] ${msg}`, ...prev.slice(0, 19)])
  }

  useEffect(() => {
    // attempt websocket
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket

    const onStatus = (payload: any) => {
      if (Array.isArray(payload?.lights)) {
        const next: Record<string, UILight> = {}
        ;(payload.lights as any[]).forEach((l) => {
          const id = String(l.name)
          next[id] = { id, label: prettyLabel(id), isOn: !!l.state, pin: typeof l.pin === 'number' ? l.pin : undefined }
        })
        setLights(next)
        // Clear optimistic pins that are now covered by latest status
        setPinOptimistic((prev) => {
          const copy = { ...prev }
          for (const p of Object.keys(copy)) {
            const pinNum = Number(p)
            // if any light reports this pin, clear the optimistic override
            if (Object.values(next).some((L) => L.pin === pinNum)) {
              delete copy[pinNum]
            }
          }
          return copy
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
    const allOn = Object.values(lights).every((l) => l.isOn)
    socketRef.current?.emit("cmd", { action: "set", target: "all", state: !allOn })
    pushLog(`cmd(set) all -> ${!allOn}`)
  }

  // --- PIN controls ---
  const allowedPins = [19, 21, 22, 23]
  const pinState: Record<number, boolean> = {}
  for (const p of allowedPins) pinState[p] = false
  for (const L of Object.values(lights)) {
    if (typeof L.pin === 'number' && allowedPins.includes(L.pin)) {
      pinState[L.pin] = pinState[L.pin] || L.isOn
    }
  }
  // Apply optimistic overrides
  for (const p of allowedPins) {
    if (p in pinOptimistic) pinState[p] = !!pinOptimistic[p]
  }
  const togglePin = (pin: number, next: boolean) => {
    // optimistic update
    setPinOptimistic((m) => ({ ...m, [pin]: next }))
    socketRef.current?.emit("cmd", { action: "set_pin", pin, state: next })
    pushLog(`cmd(set_pin) ${pin} -> ${next}`)
  }

  const onCount = Object.values(lights).filter((l) => l.isOn).length
  const total = Object.keys(lights).length

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-muted-foreground">
          {onCount} of {total} lights on
        </span>
        <Button variant="outline" size="sm" onClick={toggleAll} className="text-xs bg-transparent">
          Toggle All
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

      {logLines.length > 0 && (
        <div className="mt-4 p-3 bg-muted rounded-lg">
          <h4 className="text-xs font-medium mb-2">Recent Server Logs</h4>
          <div className="space-y-1">
            {logLines.slice(0, 5).map((msg, index) => (
              <div key={index} className="text-xs font-mono text-muted-foreground">
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}
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
