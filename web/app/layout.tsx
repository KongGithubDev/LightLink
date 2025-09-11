import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  metadataBase: (() => {
    try { return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000") } catch { return undefined }
  })(),
  title: {
    default: "LightLink",
    template: "%s · LightLink",
  },
  description: "Control your home lighting with ESP32 + Next.js. Real-time dashboard, scheduling, and secure APIs.",
  applicationName: "LightLink",
  openGraph: {
    title: "LightLink",
    description: "Control your home lighting with ESP32 + Next.js. Real-time dashboard, scheduling, and secure APIs.",
    url: "/",
    siteName: "LightLink",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LightLink",
    description: "Control your home lighting with ESP32 + Next.js. Real-time dashboard, scheduling, and secure APIs.",
  },
  generator: "LightLink",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
