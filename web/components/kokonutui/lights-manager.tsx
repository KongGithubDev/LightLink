"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, PlusCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { listLights, createLight, deleteLight, updateLight, type LightDoc } from "@/lib/api"

interface Props { className?: string }

export default function LightsManager({ className }: Props) {
  const [lights, setLights] = useState<LightDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<LightDoc>({ name: "", pin: 19, on: "18:00", off: "23:00", scheduleEnabled: false })
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listLights()
      setLights(res.lights || [])
    } catch (e: any) {
      setError("Failed to load lights")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const onCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const payload: LightDoc = {
        name: form.name.trim(),
        pin: Number(form.pin),
        on: form.on || "00:00",
        off: form.off || "00:00",
        scheduleEnabled: !!form.scheduleEnabled,
      }
      if (!payload.name) throw new Error("Name required")
      await createLight(payload)
      setForm({ name: "", pin: 0, on: "18:00", off: "23:00", scheduleEnabled: false })
      await refresh()
    } catch (e: any) {
      setError(e?.message || "Create failed")
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (name: string) => {
    if (!confirm(`Delete light "${name}"?`)) return
    try {
      await deleteLight(name)
      await refresh()
    } catch {
      setError("Delete failed")
    }
  }

  const onUpdate = async (name: string, patch: Partial<LightDoc>) => {
    try {
      await updateLight(name, patch)
      await refresh()
    } catch {
      setError("Update failed")
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <PlusCircle className="w-4 h-4" />
          <span className="font-medium text-sm">Add Light</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Pin</Label>
            <select
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: Number(e.target.value) })}
              className="text-sm h-9 w-full rounded-md border border-input bg-background px-3 py-1"
            >
              <option value={19}>19</option>
              <option value={21}>21</option>
              <option value={22}>22</option>
              <option value={23}>23</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">On</Label>
            <Input type="time" value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Off</Label>
            <Input type="time" value={form.off} onChange={(e) => setForm({ ...form, off: e.target.value })} className="text-sm" />
          </div>
          <div className="flex items-end">
            <Button onClick={onCreate} disabled={creating} className="w-full text-sm">{creating ? "Adding..." : "Add"}</Button>
          </div>
        </div>
        {error && <div className="text-xs text-red-500 mt-2">{error}</div>}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-sm">Lights Catalog</span>
          <Button variant="outline" size="sm" onClick={refresh} className="text-xs bg-transparent">{loading ? "Loading..." : "Refresh"}</Button>
        </div>
        <div className="space-y-2">
          {lights.length === 0 && <div className="text-sm text-muted-foreground">No lights in database yet.</div>}
          {lights.map((l) => (
            <div key={l.name} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-center border rounded-md p-3">
              <div className="text-sm font-medium">{l.name}</div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Pin</Label>
                <select
                  value={l.pin}
                  onChange={(e) => onUpdate(l.name, { pin: Number(e.target.value) })}
                  className="text-sm h-9 rounded-md border border-input bg-background px-2 py-1 w-24"
                >
                  <option value={19}>19</option>
                  <option value={21}>21</option>
                  <option value={22}>22</option>
                  <option value={23}>23</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">On</Label>
                <Input type="time" value={l.on || "00:00"} onChange={(e) => onUpdate(l.name, { on: e.target.value })} className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Off</Label>
                <Input type="time" value={l.off || "00:00"} onChange={(e) => onUpdate(l.name, { off: e.target.value })} className="text-sm" />
              </div>
              <div className="text-xs text-muted-foreground">Sched: {l.scheduleEnabled ? "on" : "off"}</div>
              <div className="flex justify-end">
                <Button variant="destructive" size="icon" onClick={() => onDelete(l.name)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
