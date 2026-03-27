import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useLogs(maxLogs = 50) {
  const [logs, setLogs] = useState([])
  const channelRef = useRef(null)

  useEffect(() => {
    if (!supabase) return

    // Fetch recent logs
    async function fetchLogs() {
      const { data } = await supabase
        .from('QMS_AirHive_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(maxLogs)

      if (data) setLogs(data.reverse())
    }

    fetchLogs()

    // Subscribe to new logs in realtime
    channelRef.current = supabase
      .channel('logs-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'QMS_AirHive_logs' },
        (payload) => {
          setLogs((prev) => {
            const next = [...prev, payload.new]
            return next.length > maxLogs ? next.slice(-maxLogs) : next
          })
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [maxLogs])

  return logs
}
