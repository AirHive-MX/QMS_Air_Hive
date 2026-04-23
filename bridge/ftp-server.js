import { FtpSrv } from 'ftp-srv'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

/**
 * FTP Server for receiving inspection images from Keyence VS Creator.
 *
 * The camera acts as FTP client and pushes images after each inspection.
 * Images are saved locally, then an event is emitted for upload to Supabase.
 */
export class ImageFtpServer extends EventEmitter {
  constructor(options = {}) {
    super()
    this.host = options.host || '0.0.0.0'
    this.port = options.port || 21
    this.user = options.user || 'camera'
    this.password = options.password || 'camera'
    this.imageDir = options.imageDir || path.join(path.dirname(import.meta.filename), 'images')
    this.pasvUrl = options.pasv_url || '169.254.162.1'
    this.server = null

    // Ensure image directory exists
    if (!fs.existsSync(this.imageDir)) {
      fs.mkdirSync(this.imageDir, { recursive: true })
    }
  }

  start() {
    this.server = new FtpSrv({
      url: `ftp://${this.host}:${this.port}`,
      anonymous: false,
      pasv_url: this.host === '0.0.0.0' ? this.pasvUrl : this.host,
      pasv_min: 1024,
      pasv_max: 1048,
    })

    this.server.on('login', ({ connection, username, password }, resolve, reject) => {
      if (username === this.user && password === this.password) {
        console.log(`[FTP] Client authenticated: ${username}`)

        // Use the images directory as root
        resolve({ root: this.imageDir })

        // Listen for file uploads on this connection
        connection.on('STOR', (error, filePath) => {
          if (error) {
            console.error(`[FTP] Upload error: ${error.message}`)
            return
          }
          console.log(`[FTP] Image received: ${filePath}`)
          this.emit('image-received', filePath)
        })
      } else {
        console.warn(`[FTP] Auth failed: ${username}`)
        reject(new Error('Invalid credentials'))
      }
    })

    this.server.on('client-error', ({ context, error }) => {
      console.error(`[FTP] Client error: ${error.message}`)
    })

    return this.server.listen()
      .then(() => {
        console.log(`[FTP] Server listening on port ${this.port}`)
        console.log(`[FTP] User: ${this.user} | Image dir: ${this.imageDir}`)
      })
  }

  stop() {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
