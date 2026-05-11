import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const TABLE = 'QMS_AirHive_measurement_specs'

export function useMeasurementSpecs() {
  const [specs, setSpecs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    async function fetchInitial() {
      const { data } = await supabase.from(TABLE).select('*')
      setSpecs(data || [])
      setLoading(false)
    }
    fetchInitial()

    const channel = supabase
      .channel('measurement-specs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSpecs((prev) => [...prev, payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setSpecs((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)))
        } else if (payload.eventType === 'DELETE') {
          setSpecs((prev) => prev.filter((s) => s.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const getSpec = useCallback(
    (modelName, measurementName) => {
      if (!modelName || !measurementName) return null
      return specs.find(
        (s) => s.model_name === modelName && s.measurement_name === measurementName
      ) || null
    },
    [specs]
  )

  const upsertSpec = useCallback(async ({ model_name, measurement_name, nominal, usl, lsl, unit }) => {
    if (!supabase) return
    const payload = {
      model_name,
      measurement_name,
      nominal: nominal === '' || nominal == null ? null : parseFloat(nominal),
      usl: usl === '' || usl == null ? null : parseFloat(usl),
      lsl: lsl === '' || lsl == null ? null : parseFloat(lsl),
      unit: unit || 'mm',
    }
    const { error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'model_name,measurement_name' })
    if (error) console.error('[Specs] Upsert error:', error)
  }, [])

  const deleteSpec = useCallback(async (id) => {
    if (!supabase) return
    await supabase.from(TABLE).delete().eq('id', id)
  }, [])

  return { specs, loading, getSpec, upsertSpec, deleteSpec }
}
