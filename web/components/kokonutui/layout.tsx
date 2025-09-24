"use client"

import type { ReactNode } from "react"
import TopNav from "./top-nav"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className={`flex h-screen flex-col ${theme === "dark" ? "dark" : ""}`}>
      <header className="h-14 sm:h-16 border-b border-gray-200 dark:border-[#1F1F23] pt-[env(safe-area-inset-top)]">
        <TopNav />
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] bg-white dark:bg-[#0F0F12]">{children}</main>
    </div>
  )
}
