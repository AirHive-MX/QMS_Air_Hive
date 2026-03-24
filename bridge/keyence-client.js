import net from 'node:net'
import { EventEmitter } from 'node:events'

/**
 * KeyenceClient - TCP client for Keyence VS Series cameras
 * Uses Non-Procedural Communication protocol on port 8500
 *
 * Protocol: Text-based commands over TCP socket
 * Delimiter: CR (\r) by default
 * Commands: TRG, MOR, HMR, FVR, EC, RUN, SET, etc.
 */
export class KeyenceClient extends EventEmitter {
  constructor(ip, port = 8500) {
    super()
    this.ip = ip
    this.port = port
    this.socket = null
    this.connected = false
    this.delimiter = '\r'
    this.buffer = ''
    this.pendingCommand = null
    this.reconnectTimer = null
    this.reconnectInterval = 5000
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.destroy()
      }

      this.socket = new net.Socket()
      this.socket.setEncoding('utf8')

      this.socket.connect(this.port, this.ip, () => {
        this.connected = true
        console.log(`[Keyence] Connected to ${this.ip}:${this.port}`)
        this.emit('connected')
        this.clearReconnect()
        resolve()
      })

      this.socket.on('data', (data) => {
        this.handleData(data)
      })

      this.socket.on('error', (err) => {
        console.error(`[Keyence] Socket error: ${err.message}`)
        this.emit('error', err)
        if (!this.connected) {
          reject(err)
        }
      })

      this.socket.on('close', () => {
        const wasConnected = this.connected
        this.connected = false
        console.log('[Keyence] Connection closed')
        this.emit('disconnected')
        if (wasConnected) {
          this.scheduleReconnect()
        }
      })

      this.socket.setTimeout(10000, () => {
        if (!this.connected) {
          this.socket.destroy()
          reject(new Error('Connection timeout'))
        }
      })
    })
  }

  handleData(data) {
    this.buffer += data

    let delimIndex
    while ((delimIndex = this.buffer.indexOf(this.delimiter)) !== -1) {
      const message = this.buffer.substring(0, delimIndex).trim()
      this.buffer = this.buffer.substring(delimIndex + this.delimiter.length)

      if (message) {
        if (this.pendingCommand) {
          const { resolve } = this.pendingCommand
          this.pendingCommand = null
          resolve(message)
        } else {
          // Unsolicited data from camera (Data Output Non-Procedural)
          this.emit('inspection-data', message)
        }
      }
    }
  }

  sendCommand(command, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error('Not connected to camera'))
        return
      }

      // If there's a pending command, reject it
      if (this.pendingCommand) {
        this.pendingCommand.reject(new Error('Command superseded'))
      }

      const timer = setTimeout(() => {
        if (this.pendingCommand) {
          this.pendingCommand = null
          reject(new Error(`Command timeout: ${command}`))
        }
      }, timeoutMs)

      this.pendingCommand = {
        resolve: (response) => {
          clearTimeout(timer)
          resolve(response)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      }

      this.socket.write(command + this.delimiter)
    })
  }

  async trigger() {
    const response = await this.sendCommand('TRG')
    if (response.startsWith('ER')) {
      throw new Error(`Trigger error: ${response}`)
    }
    return response
  }

  async getMode() {
    const response = await this.sendCommand('MOR')
    // Response: MOR,n where n=0 (Setup) or n=1 (Run)
    const parts = response.split(',')
    return parts[1] === '1' ? 'RUN' : 'SETUP'
  }

  async getModel() {
    const response = await this.sendCommand('HMR')
    // Response: HMR,model
    const parts = response.split(',')
    return parts.slice(1).join(',')
  }

  async getFirmwareVersion() {
    const response = await this.sendCommand('FVR')
    // Response: FVR,version
    const parts = response.split(',')
    return parts.slice(1).join(',')
  }

  async echo(value = 1234) {
    const response = await this.sendCommand(`EC,${value}`)
    // Response: EC,value
    return response
  }

  async getProgram() {
    const response = await this.sendCommand('PR')
    // Response: PR,d,nnnn
    const parts = response.split(',')
    return {
      storage: parts[1] === '1' ? 'internal' : 'sd',
      programNumber: parseInt(parts[2], 10),
    }
  }

  async switchToRun() {
    return this.sendCommand('RUN')
  }

  async switchToSetup() {
    return this.sendCommand('SET')
  }

  async reset() {
    return this.sendCommand('RS')
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    console.log(`[Keyence] Reconnecting in ${this.reconnectInterval / 1000}s...`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connect()
      } catch {
        this.scheduleReconnect()
      }
    }, this.reconnectInterval)
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  disconnect() {
    this.clearReconnect()
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.connected = false
  }
}
