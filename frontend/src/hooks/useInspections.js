import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useInspections() {
  const [latestInspection, setLatestInspection] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    async function fetchInitial() {
      const { data } = await supabase
        .from('QMS_AirHive_inspections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      if (data && data.length > 0) {
        setLatestInspection(data[0])
        setHistory(data)
      }
      setLoading(false)
    }

    fetchInitial()

    const channel = supabase
      .channel('inspections-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'QMS_AirHive_inspections' },
        (payload) => {
          const newInspection = payload.new
          setLatestInspection(newInspection)
          setHistory((prev) => [newInspection, ...prev].slice(0, 10))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { latestInspection, history, loading }
}
