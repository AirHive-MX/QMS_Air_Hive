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

  /**
   * Send a diagnostic log to Supabase (visible in HMI diagnostic panel)
   */
  async log(level, source, message, rawData = null) {
    try {
      await this.supabase
        .from('QMS_AirHive_logs')
        .insert({ level, source, message, raw_data: rawData })
    } catch {
      // Don't let log failures break the main flow
    }
  }

  /**
   * Cleanup old logs (keep last 200)
   */
  async cleanupLogs() {
    try {
      const { data } = await this.supabase
        .from('QMS_AirHive_logs')
        .select('id')
        .order('created_at', { ascending: false })
        .range(200, 300)

      if (data && data.length > 0) {
        const ids = data.map((r) => r.id)
        await this.supabase.from('QMS_AirHive_logs').delete().in('id', ids)
      }
    } catch {
      // non-critical
    }
  }

  /**
   * Upload image to Supabase Storage and return public URL
   */
  async uploadImage(filePath, inspectionId) {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const ext = path.extname(filePath).toLowerCase()
    const contentType = ext === '.bmp' ? 'image/bmp' : 'image/jpeg'
    const storagePath = `inspections/${inspectionId}${ext}`

    const fileBuffer = fs.readFileSync(filePath)

    const { error } = await this.supabase.storage
      .from('inspection-images')
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true,
      })

    if (error) {
      console.error('[Supabase] Image upload error:', error.message)
      throw error
    }

    const { data: urlData } = this.supabase.storage
      .from('inspection-images')
      .getPublicUrl(storagePath)

    const imageUrl = urlData.publicUrl
    console.log(`[Supabase] Image uploaded: ${storagePath}`)
    return imageUrl
  }

  /**
   * Attach image/graphics URL to an existing inspection record
   */
  async attachImage(inspectionId, imageUrl, graphicsUrl) {
    const update = {}
    if (imageUrl) update.image_url = imageUrl
    if (graphicsUrl) update.graphics_url = graphicsUrl

    const { error } = await this.supabase
      .from('QMS_AirHive_inspections')
      .update(update)
      .eq('id', inspectionId)

    if (error) {
      console.error('[Supabase] Error attaching image:', error.message)
    } else {
      console.log(`[Supabase] Image attached to inspection ${inspectionId}`)
    }
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
