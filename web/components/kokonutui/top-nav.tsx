"use client"

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Bell, ChevronRight } from "lucide-react"
import Profile01 from "./profile-01"
import Link from "next/link"
import { ThemeToggle } from "../theme-toggle"
import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"

interface BreadcrumbItem {
  label: string
  href?: string
}

export default function TopNav() {
  const breadcrumbs: BreadcrumbItem[] = [
    { label: "KongWatcharapong", href: "#" },
    { label: "LightLink", href: "#" },
  ]

  // Real-time 24h clock in navbar
  const [nowStr, setNowStr] = useState<string>("--:--:--")
  // WS status
  type ConnState = "connected" | "connecting" | "disconnected"
  const [state, setState] = useState<ConnState>("connecting")
  const socketRef = useRef<Socket | null>(null)
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      setNowStr(`${hh}:${mm}:${ss}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Minimal WS connection just for showing navbar status
  useEffect(() => {
    const socket: Socket = io(undefined, { path: "/api/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket
    const onConnect = () => setState("connected")
    const onDisconnect = () => setState("disconnected")
    const onError = () => setState((s) => (s === "connected" ? "connected" : "disconnected"))
    // initial state
    setState("connecting")
    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onError)
    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onError)
      socket.close()
      socketRef.current = null
    }
  }, [])

  return (
    <nav className="px-3 sm:px-6 flex items-center justify-between bg-white dark:bg-[#0F0F12] border-b border-gray-200 dark:border-[#1F1F23] h-full">
      <div className="font-medium text-sm hidden sm:flex items-center space-x-1 truncate max-w-[300px]">
        {breadcrumbs.map((item, index) => (
          <div key={item.label} className="flex items-center">
            {index > 0 && <ChevronRight className="h-4 w-4 text-gray-500 dark:text-gray-400 mx-1" />}
            {item.href ? (
              <Link
                href={item.href}
                className="text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-gray-900 dark:text-gray-100">{item.label}</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0">
        <span className={`hidden sm:inline-flex items-center px-2 py-1 text-xs rounded-full border ${state === 'connected' ? 'bg-green-100 text-green-700 border-green-200' : state === 'connecting' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
          WS: {state}
        </span>
        <span className="hidden sm:inline-flex items-center px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-[#1F1F23] font-mono">{nowStr}</span>
        <button
          type="button"
          className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-[#1F1F23] rounded-full transition-colors"
        >
          <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-300" />
        </button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none">
            
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-[280px] sm:w-80 bg-background border-border rounded-lg shadow-lg"
          >
            <Profile01 avatar="https://ferf1mheo22r9ira.public.blob.vercel-storage.com/avatar-01-n0x8HFv8EUetf9z6ht0wScJKoTHqf8.png" />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
