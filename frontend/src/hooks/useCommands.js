import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function useCommands() {
  const [sending, setSending] = useState(false)

  async function sendCommand(command, params = null) {
    if (!supabase) {
      console.warn('Supabase not configured')
      return null
    }

    setSending(true)
    try {
      const { data, error } = await supabase
        .from('QMS_AirHive_commands')
        .insert({ command, params })
        .select()
        .single()

      if (error) throw error
      return data
    } catch (err) {
      console.error('Error sending command:', err)
      return null
    } finally {
      setSending(false)
    }
  }

  async function trigger() {
    return sendCommand('TRG')
  }

  return { trigger, sendCommand, sending }
}
