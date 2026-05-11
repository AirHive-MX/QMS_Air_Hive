import { useState, useRef, useEffect, useCallback } from 'react'

const BATCH_SIZE = 10
const TIMEOUT_MS = 8000 // give up on a shot after 8s

export default function BatchTriggerButton({ onTrigger, latestInspection, disabled }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0) // count of completed shots
  const lastInspectionIdRef = useRef(null)
  const waitingResolveRef = useRef(null)
  const cancelRef = useRef(false)

  // When a new inspection arrives, resolve the pending wait (if any)
  useEffect(() => {
    if (
      latestInspection?.id &&
      latestInspection.id !== lastInspectionIdRef.current &&
      waitingResolveRef.current
    ) {
      lastInspectionIdRef.current = latestInspection.id
      const resolve = waitingResolveRef.current
      waitingResolveRef.current = null
      resolve(true)
    }
  }, [latestInspection?.id])

  const waitForNewInspection = useCallback(() => {
    return new Promise((resolve) => {
      waitingResolveRef.current = resolve
      setTimeout(() => {
        if (waitingResolveRef.current === resolve) {
          waitingResolveRef.current = null
          resolve(false) // timeout
        }
      }, TIMEOUT_MS)
    })
  }, [])

  const handleClick = async () => {
    if (running) {
      cancelRef.current = true
      return
    }
    cancelRef.current = false
    setRunning(true)
    setProgress(0)
    lastInspectionIdRef.current = latestInspection?.id || null

    for (let i = 0; i < BATCH_SIZE; i++) {
      if (cancelRef.current) break
      await onTrigger()
      const arrived = await waitForNewInspection()
      if (cancelRef.current) break
      setProgress(i + 1)
      if (!arrived) {
        console.warn(`[BatchTrigger] Shot ${i + 1} timed out — continuing anyway`)
      }
    }

    setRunning(false)
    waitingResolveRef.current = null
  }

  const label = running
    ? `${progress}/${BATCH_SIZE}${cancelRef.current ? ' Cancelando…' : ''}`
    : `Lote x${BATCH_SIZE}`

  return (
    <button
      className={`batch-btn ${running ? 'batch-btn--running' : ''}`}
      onClick={handleClick}
      disabled={disabled && !running}
      title={running ? 'Click para cancelar' : `Disparar ${BATCH_SIZE} veces seguidas`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {running ? (
          <rect x="6" y="6" width="12" height="12" />
        ) : (
          <>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </>
        )}
      </svg>
      <span className="batch-btn__count">{label}</span>
    </button>
  )
}
