"use client"

import { useEffect } from "react"
import { observeNativeNotifications } from "@/lib/native/notify"
import { useProvider } from "@/providers/use-provider"

/** Sync native notifications after the SDK initializes. */
export function NotifyProvider() {
  const provider = useProvider()
  const nativeNotification = provider.nativeNotification

  useEffect(() => {
    return observeNativeNotifications(nativeNotification, provider.id)
  }, [nativeNotification, provider.id])

  return null
}
