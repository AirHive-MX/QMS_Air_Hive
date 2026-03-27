import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const HEARTBEAT_STALE_MS = 30000 // 30s without heartbeat = bridge down

export function useBridgeStatus() {
  const [status, setStatus] = useState({
    is_connected: false,
    camera_ip: null,
    camera_model: null,
    camera_mode: null,
    firmware_version: null,
    last_heartbeat: null,
  })
  const [supabaseOk, setSupabaseOk] = useState(false)
  const [bridgeAlive, setBridgeAlive] = useState(false)
  const statusRef = useRef(status)
  const intervalRef = useRef(null)

  // Keep ref in sync so the interval can read fresh values
  statusRef.current = status

  const checkHeartbeat = useCallback((lastHeartbeat) => {
    if (!lastHeartbeat) {
      setBridgeAlive(false)
      return
    }
    const age = Date.now() - new Date(lastHeartbeat).getTime()
    setBridgeAlive(age < HEARTBEAT_STALE_MS)
  }, [])

  useEffect(() => {
    if (!supabase) return

    async function fetchStatus() {
      try {
        const { data, error } = await supabase
          .from('QMS_AirHive_bridge_status')
          .select('*')
          .eq('id', 1)
          .single()

        if (!error && data) {
          setStatus(data)
          setSupabaseOk(true)
          checkHeartbeat(data.last_heartbeat)
        }
      } catch {
        setSupabaseOk(false)
      }
    }

    fetchStatus()

    // Periodically check heartbeat freshness using ref for latest value
    intervalRef.current = setInterval(() => {
      checkHeartbeat(statusRef.current.last_heartbeat)
    }, 5000)

    const channel = supabase
      .channel('bridge-status-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'QMS_AirHive_bridge_status', filter: 'id=eq.1' },
        (payload) => {
          setStatus(payload.new)
          checkHeartbeat(payload.new.last_heartbeat)
        }
      )
      .subscribe((subStatus) => {
        // Only mark as disconnected on definitive failure states
        if (subStatus === 'SUBSCRIBED') {
          setSupabaseOk(true)
        } else if (subStatus === 'CLOSED' || subStatus === 'CHANNEL_ERROR') {
          setSupabaseOk(false)
        }
        // Ignore intermediate states like 'TIMED_OUT' (Supabase auto-reconnects)
      })

    return () => {
      supabase.removeChannel(channel)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [checkHeartbeat])

  // Re-check heartbeat when status.last_heartbeat changes
  useEffect(() => {
    checkHeartbeat(status.last_heartbeat)
  }, [status.last_heartbeat, checkHeartbeat])

  // Camera is only truly connected if the bridge is also alive
  // (otherwise is_connected is stale data from a previous session)
  const cameraConnected = bridgeAlive && status.is_connected

  return {
    ...status,
    supabaseOk,
    bridgeAlive,
    cameraConnected,
  }
}
