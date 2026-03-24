import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useBridgeStatus() {
  const [status, setStatus] = useState({
    is_connected: false,
    camera_ip: null,
    camera_model: null,
    camera_mode: null,
    firmware_version: null,
    last_heartbeat: null,
  })

  useEffect(() => {
    if (!supabase) return

    async function fetchStatus() {
      const { data } = await supabase
        .from('QMS_AirHive_bridge_status')
        .select('*')
        .eq('id', 1)
        .single()

      if (data) setStatus(data)
    }

    fetchStatus()

    const channel = supabase
      .channel('bridge-status-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'QMS_AirHive_bridge_status', filter: 'id=eq.1' },
        (payload) => {
          setStatus(payload.new)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return status
}
