"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"

type AnimatedAlertProps = {
  show: boolean
  children: React.ReactNode
  className?: string
  motionKey?: React.Key
  offsetY?: number
  duration?: number
}

function AnimatedAlert({
  show,
  children,
  className,
  motionKey = "animated-alert",
  offsetY = -6,
  duration = 0.18,
}: AnimatedAlertProps) {
  const shouldReduceMotion = useReducedMotion()
  const y = shouldReduceMotion ? 0 : offsetY

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key={motionKey}
          initial={{ opacity: 0, y }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y }}
          transition={{ duration: shouldReduceMotion ? 0 : duration, ease: "easeOut" }}
          className={cn(className)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export { AnimatedAlert }
export type { AnimatedAlertProps }

