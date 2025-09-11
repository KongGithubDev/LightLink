// Deprecated: MQTT has been replaced by HTTP/WebSocket APIs.
// This file intentionally exports no-op stubs to avoid breaking leftover imports.

export const BROKER_URL = ""
export const STATUS_TOPIC = ""
export const CMD_TOPIC = ""

export function getMqttClient(): any {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[deprecated] mqttClient is no longer used. Switched to HTTP/WebSocket.")
  }
  return {
    publish: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    on: () => {},
    off: () => {},
    end: () => {},
    options: {},
  }
}
