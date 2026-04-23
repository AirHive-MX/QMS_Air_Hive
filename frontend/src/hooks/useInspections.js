import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useInspections() {
  const [latestInspection, setLatestInspection] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  // Fetch SVG content from graphics_url when graphics_content is missing
  const fetchGraphics = useCallback(async (inspection) => {
    if (!inspection?.graphics_url || inspection.graphics_content) return
    try {
      const res = await fetch(inspection.graphics_url)
      if (!res.ok) return
      let svg = await res.text()
      // Strip width/height so CSS controls sizing (Storage version has them)
      svg = svg.replace(/<svg([^>]*)\s+width="[^"]*"/, '<svg$1')
      svg = svg.replace(/<svg([^>]*)\s+height="[^"]*"/, '<svg$1')
      const id = inspection.id
      setLatestInspection((prev) =>
        prev && prev.id === id ? { ...prev, graphics_content: svg } : prev
      )
      setHistory((prev) =>
        prev.map((item) => (item.id === id ? { ...item, graphics_content: svg } : item))
      )
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    async function fetchInitial() {
      const { data } = await supabase
        .from('QMS_AirHive_inspections')
        .select('*')
        .not('graphics_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10)

      if (data && data.length > 0) {
        setLatestInspection(data[0])
        setHistory(data)
        // Fetch SVG content for the latest inspection
        fetchGraphics(data[0])
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'QMS_AirHive_inspections' },
        (payload) => {
          const updated = payload.new
          setLatestInspection((prev) =>
            prev && prev.id === updated.id ? { ...prev, ...updated } : prev
          )
          setHistory((prev) =>
            prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
          )
          // Fallback: if broadcast didn't deliver graphics_content, fetch from URL
          if (updated.graphics_url) {
            fetchGraphics(updated)
          }
        }
      )
      .subscribe()

    // Broadcast channel: receive images + graphics instantly from bridge
    const imageChannel = supabase
      .channel('inspection-images')
      .on('broadcast', { event: 'image' }, ({ payload }) => {
        const { inspection_id, image_data } = payload
        setLatestInspection((prev) =>
          prev && prev.id === inspection_id ? { ...prev, image_url: image_data } : prev
        )
        setHistory((prev) =>
          prev.map((item) =>
            item.id === inspection_id ? { ...item, image_url: image_data } : item
          )
        )
      })
      .on('broadcast', { event: 'graphics' }, ({ payload }) => {
        const { inspection_id, svg_content } = payload
        setLatestInspection((prev) =>
          prev && prev.id === inspection_id ? { ...prev, graphics_content: svg_content } : prev
        )
        setHistory((prev) =>
          prev.map((item) =>
            item.id === inspection_id ? { ...item, graphics_content: svg_content } : item
          )
        )
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(imageChannel)
    }
  }, [fetchGraphics])

  function clearDisplay() {
    setLatestInspection(null)
    setHistory([])
  }

  return { latestInspection, history, loading, clearDisplay }
}
