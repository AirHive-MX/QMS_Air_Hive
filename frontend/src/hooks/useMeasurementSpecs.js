import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const TABLE = 'QMS_AirHive_measurement_specs'

export function useMeasurementSpecs() {
  const [specs, setSpecs] = useState([])
  const [loading, setLoading] = useState(true)
  // Unique channel suffix per hook instance — prevents subscription collision
  // when the hook is used in multiple components simultaneously.
  const instanceIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)

  const refetch = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from(TABLE).select('*')
    if (data) setSpecs(data)
  }, [])

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

    const id = instanceIdRef.current

    // Realtime subscription (primary path)
    const channel = supabase
      .channel(`measurement-specs-realtime-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSpecs((prev) => {
            if (prev.some((s) => s.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        } else if (payload.eventType === 'UPDATE') {
          setSpecs((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)))
        } else if (payload.eventType === 'DELETE') {
          setSpecs((prev) => prev.filter((s) => s.id !== payload.old.id))
        }
      })
      .subscribe()

    // Fallback: refetch all specs whenever a new inspection arrives (bridge upserts specs
    // right before/after). This guarantees freshness even if realtime UPDATE drops.
    const inspectionChannel = supabase
      .channel(`specs-refetch-on-inspection-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'QMS_AirHive_inspections' },
        () => {
          setTimeout(refetch, 400)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(inspectionChannel)
    }
  }, [refetch])

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

  // Bulk upsert: rows = [{ model_name, measurement_name, nominal, usl, lsl, unit }, ...]
  const upsertSpecsBulk = useCallback(async (rows) => {
    if (!supabase || !rows?.length) return { ok: 0, error: 0 }
    const payload = rows.map((r) => ({
      model_name: r.model_name,
      measurement_name: r.measurement_name,
      nominal: r.nominal == null || r.nominal === '' ? null : parseFloat(r.nominal),
      usl: r.usl == null || r.usl === '' ? null : parseFloat(r.usl),
      lsl: r.lsl == null || r.lsl === '' ? null : parseFloat(r.lsl),
      unit: r.unit || 'mm',
    }))
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'model_name,measurement_name' })
      .select()
    if (error) {
      console.error('[Specs] Bulk upsert error:', error)
      return { ok: 0, error: rows.length, message: error.message }
    }
    return { ok: data?.length ?? rows.length, error: 0 }
  }, [])

  return { specs, loading, getSpec, upsertSpec, upsertSpecsBulk, deleteSpec, refetch }
}
