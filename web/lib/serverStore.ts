// Simple in-memory store for device status and command queue
// NOTE: This resets when the server restarts. For production, replace with a DB.

export type LightState = {
  name: string
  state: boolean
  on: string
  off: string
  scheduleEnabled: boolean
}

export type DeviceStatus = {
  device: string
  lights: LightState[]
  updatedAt: number
}

class ServerStore {
  private latestStatus: DeviceStatus | null = null
  private cmdQueue: any[] = []
  private subscribers = new Set<(data: string) => void>()

  getStatus(): DeviceStatus | null {
    return this.latestStatus
  }

  setStatus(status: DeviceStatus) {
    this.latestStatus = { ...status, updatedAt: Date.now() }
    this.broadcast({ type: "status", payload: this.latestStatus })
  }

  enqueueCmd(cmd: any) {
    this.cmdQueue.push(cmd)
  }

  drainCmds(): any[] {
    const out = this.cmdQueue
    this.cmdQueue = []
    return out
  }

  // SSE helpers
  subscribe(send: (data: string) => void) {
    this.subscribers.add(send)
  }
  unsubscribe(send: (data: string) => void) {
    this.subscribers.delete(send)
  }
  broadcast(obj: any) {
    const data = `data: ${JSON.stringify(obj)}\n\n`
    for (const fn of this.subscribers) {
      try { fn(data) } catch {}
    }
  }
}

let store: ServerStore | null = null
export function getStore() {
  if (!store) store = new ServerStore()
  return store
}
