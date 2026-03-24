import { createClient } from '@supabase/supabase-js'

/**
 * SupabaseSync - Synchronizes camera data with Supabase
 *
 * Responsibilities:
 * - Listen for pending commands from the HMI
 * - Write inspection results to Supabase
 * - Update bridge connection status
 */
export class SupabaseSync {
  constructor(supabaseUrl, supabaseKey) {
    this.supabase = createClient(supabaseUrl, supabaseKey)
    this.commandChannel = null
    this.onCommandCallback = null
  }

  /**
   * Start listening for pending commands from the HMI
   */
  startCommandListener(onCommand) {
    this.onCommandCallback = onCommand

    // Poll for pending commands every second
    this.pollTimer = setInterval(() => this.pollCommands(), 1000)

    // Also use realtime for faster response
    this.commandChannel = this.supabase
      .channel('commands-listener')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'QMS_AirHive_commands' },
        (payload) => {
          if (payload.new.status === 'pending') {
            this.processCommand(payload.new)
          }
        }
      )
      .subscribe()

    console.log('[Supabase] Command listener started')
  }

  async pollCommands() {
    try {
      const { data } = await this.supabase
        .from('QMS_AirHive_commands')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)

      if (data && data.length > 0) {
        await this.processCommand(data[0])
      }
    } catch (err) {
      console.error('[Supabase] Poll error:', err.message)
    }
  }

  async processCommand(command) {
    // Mark as sent
    await this.supabase
      .from('QMS_AirHive_commands')
      .update({ status: 'sent' })
      .eq('id', command.id)
      .eq('status', 'pending') // Only update if still pending (avoid double-processing)

    try {
      if (this.onCommandCallback) {
        await this.onCommandCallback(command)
      }

      // Mark as completed
      await this.supabase
        .from('QMS_AirHive_commands')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', command.id)
    } catch (err) {
      await this.supabase
        .from('QMS_AirHive_commands')
        .update({
          status: 'error',
          error_message: err.message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', command.id)
    }
  }

  /**
   * Save inspection result to Supabase
   */
  async saveInspection(inspectionData) {
    const { data, error } = await this.supabase
      .from('QMS_AirHive_inspections')
      .insert(inspectionData)
      .select()
      .single()

    if (error) {
      console.error('[Supabase] Error saving inspection:', error.message)
      throw error
    }

    console.log(`[Supabase] Inspection saved: ${data.result} (${data.id})`)
    return data
  }

  /**
   * Update bridge connection status
   */
  async updateStatus(statusData) {
    const { error } = await this.supabase
      .from('QMS_AirHive_bridge_status')
      .upsert({
        id: 1,
        ...statusData,
        updated_at: new Date().toISOString(),
      })

    if (error) {
      console.error('[Supabase] Error updating status:', error.message)
    }
  }

  /**
   * Send heartbeat
   */
  async heartbeat() {
    await this.updateStatus({
      last_heartbeat: new Date().toISOString(),
    })
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.commandChannel) {
      this.supabase.removeChannel(this.commandChannel)
      this.commandChannel = null
    }
  }
}
