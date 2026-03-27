import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { KeyenceClient } from './keyence-client.js'
import { SupabaseSync } from './supabase-sync.js'
import { ImageFtpServer } from './ftp-server.js'

// ============================================
// Configuration
// ============================================

const CAMERA_IP = process.env.CAMERA_IP || '127.0.0.1'
const CAMERA_PORT = parseInt(process.env.CAMERA_PORT || '8500', 10)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const HEARTBEAT_INTERVAL = 15000 // 15 seconds
const LOG_CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[Bridge] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

// ============================================
// Local file logger for raw TCP data
// ============================================

const LOG_DIR = path.join(path.dirname(import.meta.filename), 'logs')

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

const logFile = path.join(LOG_DIR, `tcp_${new Date().toISOString().slice(0, 10)}.log`)
const logStream = fs.createWriteStream(logFile, { flags: 'a' })

function logTCP(direction, data) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${direction} ${data}\n`
  logStream.write(line)
}

// ============================================
// Initialize
// ============================================

const camera = new KeyenceClient(CAMERA_IP, CAMERA_PORT)
const sync = new SupabaseSync(SUPABASE_URL, SUPABASE_SERVICE_KEY)

let cameraInfo = {
  model: null,
  mode: null,
  firmware: null,
}

// Track the latest inspection ID for image linking
let latestInspectionId = null

// ============================================
// Parse inspection data from camera
// ============================================

// VS Creator Data Output format (confirmed from real camera VS-L1500CX):
//
// Output elements are comma-separated, terminated by CR (\r)
// Elements come in pairs: label (text), value (numeric)
// First 2 elements are judgments from Task[0000]:
//   - Element 0: Overall judgment (1=OK, 0=NG)
//   - Element 1: Secondary judgment
// Then pairs: name, value, name, value, ...
//
// Real examples:
//   Just judgments:    "1,0\r"
//   With measurements: "1,0,Radio Ciculo Izquierdo,+1.174,Radio Circulo Derecho,+1.166,Medicion Ancho,+4.836,Medicion Largo,+51.418\r"

function parseInspectionData(rawData) {
  const parts = rawData.split(',').map((p) => p.trim())

  // Format A (mock/simple): PASS,1,ModelName,val1,val2,...
  if (parts.length >= 3 && /^(PASS|FAIL|OK|NG)$/i.test(parts[0])) {
    const resultText = parts[0].toUpperCase()
    const result = (resultText === 'PASS' || resultText === 'OK') ? 'PASS' : 'FAIL'
    const programNumber = parseInt(parts[1], 10) || null
    const modelName = parts[2] || null
    const values = parts.slice(3).map(Number)

    const measurements = {}
    values.forEach((val, idx) => {
      if (!isNaN(val)) {
        measurements[`dim_${idx + 1}`] = {
          value: val,
          unit: 'mm',
          pass: true,
        }
      }
    })

    return { result, program_number: programNumber, model_name: modelName, raw_data: rawData, measurements }
  }

  // Format B (VS Creator real): mixed text labels + numeric values
  // Check if first field is a numeric judgment (0 or 1)
  const firstVal = parseFloat(parts[0])
  if (!isNaN(firstVal)) {
    const result = Math.round(firstVal) >= 1 ? 'PASS' : 'FAIL'

    // Skip judgment fields at the beginning (all consecutive numeric fields)
    let dataStart = 0
    while (dataStart < parts.length && !isNaN(parseFloat(parts[dataStart]))) {
      dataStart++
    }

    const measurements = {}
    const dataParts = parts.slice(dataStart)

    // Check if remaining data has text+value pairs (name,value,name,value,...)
    if (dataParts.length >= 2 && isNaN(parseFloat(dataParts[0]))) {
      // Paired format: label, value, label, value, ...
      for (let i = 0; i < dataParts.length - 1; i += 2) {
        const name = dataParts[i]
        const val = parseFloat(dataParts[i + 1])
        if (name && !isNaN(val)) {
          measurements[name] = {
            value: parseFloat(val.toFixed(3)),
            unit: 'mm',
            pass: true,
          }
        }
      }
    } else {
      // All numeric after judgments
      dataParts.forEach((p, idx) => {
        const val = parseFloat(p)
        if (!isNaN(val)) {
          measurements[`dim_${idx + 1}`] = {
            value: parseFloat(val.toFixed(3)),
            unit: 'mm',
            pass: true,
          }
        }
      })
    }

    const measureCount = Object.keys(measurements).length
    console.log(`[Bridge] Parsed VS Creator data: ${result} | ${measureCount} measurements`)
    return { result, program_number: null, model_name: null, raw_data: rawData, measurements }
  }

  // Format C: unknown - store as raw
  console.warn('[Bridge] Unknown data format, storing raw:', rawData)
  sync.log('warn', 'parser', 'Unknown data format received', rawData)
  return {
    result: 'FAIL',
    program_number: null,
    model_name: null,
    raw_data: rawData,
    measurements: {},
  }
}

// ============================================
// Camera event handlers
// ============================================

camera.on('connected', async () => {
  try {
    cameraInfo.model = await camera.getModel()
    cameraInfo.mode = await camera.getMode()
    cameraInfo.firmware = await camera.getFirmwareVersion()

    console.log(`[Bridge] Camera info: ${cameraInfo.model} | ${cameraInfo.mode} | FW ${cameraInfo.firmware}`)

    await sync.updateStatus({
      is_connected: true,
      camera_ip: CAMERA_IP,
      camera_model: cameraInfo.model,
      camera_mode: cameraInfo.mode,
      firmware_version: cameraInfo.firmware,
    })

    await sync.log('info', 'bridge', `Connected to camera ${cameraInfo.model} (${CAMERA_IP}:${CAMERA_PORT})`)
    await sync.log('info', 'camera', `Mode: ${cameraInfo.mode} | Firmware: ${cameraInfo.firmware}`)
  } catch (err) {
    console.error('[Bridge] Error getting camera info:', err.message)
    await sync.log('error', 'bridge', `Error getting camera info: ${err.message}`)
  }
})

camera.on('disconnected', async () => {
  await sync.updateStatus({ is_connected: false })
  await sync.log('warn', 'bridge', 'Camera disconnected')
})

camera.on('inspection-data', async (data) => {
  console.log(`[Bridge] Inspection data received: ${data}`)
  logTCP('RX_DATA', data)
  await sync.log('data', 'tcp', 'Data received from camera', data)

  const inspection = parseInspectionData(data)
  if (inspection) {
    const saved = await sync.saveInspection(inspection)
    latestInspectionId = saved.id
    await sync.log('info', 'bridge', `Inspection saved: ${inspection.result}`)
  }
})

camera.on('error', async (err) => {
  console.error('[Bridge] Camera error:', err.message)
  await sync.log('error', 'camera', err.message)
})

// ============================================
// Intercept TCP raw data for logging
// ============================================

const origHandleData = camera.handleData.bind(camera)
camera.handleData = function (data) {
  logTCP('RX', data.replace(/\r/g, '<CR>').replace(/\n/g, '<LF>'))
  origHandleData(data)
}

const origSendCommand = camera.sendCommand.bind(camera)
camera.sendCommand = function (command, timeoutMs) {
  logTCP('TX', command)
  sync.log('data', 'tcp', `Sent: ${command}`)
  return origSendCommand(command, timeoutMs)
}

// ============================================
// Command handler
// ============================================

async function handleCommand(command) {
  console.log(`[Bridge] Processing command: ${command.command}`)
  await sync.log('info', 'bridge', `Processing command: ${command.command}`)

  switch (command.command.toUpperCase()) {
    case 'TRG':
      await camera.trigger()
      break
    case 'ECHO': {
      const response = await camera.echo()
      await sync.log('info', 'camera', `Echo response: ${response}`)
      break
    }
    case 'RUN':
      await camera.switchToRun()
      cameraInfo.mode = 'RUN'
      await sync.updateStatus({ camera_mode: 'RUN' })
      await sync.log('info', 'camera', 'Switched to RUN mode')
      break
    case 'SET':
      await camera.switchToSetup()
      cameraInfo.mode = 'SETUP'
      await sync.updateStatus({ camera_mode: 'SETUP' })
      await sync.log('info', 'camera', 'Switched to SETUP mode')
      break
    case 'RS':
      await camera.reset()
      await sync.log('info', 'camera', 'Camera reset')
      break
    case 'PR': {
      const prog = await camera.getProgram()
      await sync.log('info', 'camera', `Program: #${prog.programNumber} (${prog.storage})`)
      break
    }
    default:
      await camera.sendCommand(command.command)
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('[Bridge] QMS Air Hive Bridge Agent starting...')
  console.log(`[Bridge] Camera: ${CAMERA_IP}:${CAMERA_PORT}`)
  console.log(`[Bridge] Supabase: ${SUPABASE_URL}`)
  console.log(`[Bridge] TCP log: ${logFile}`)

  await sync.log('info', 'bridge', `Bridge started — connecting to ${CAMERA_IP}:${CAMERA_PORT}`)

  // Start FTP server for inspection images
  const ftpServer = new ImageFtpServer({
    port: parseInt(process.env.FTP_PORT || '2121', 10),
    user: process.env.FTP_USER || 'camera',
    password: process.env.FTP_PASS || 'camera',
  })

  ftpServer.on('image-received', async (filePath) => {
    if (!latestInspectionId) {
      console.warn('[Bridge] Image received but no inspection to link to')
      return
    }

    const ext = path.extname(filePath).toLowerCase()

    // Skip non-image files (like CheckFtpWrite.txt)
    if (!['.bmp', '.jpg', '.jpeg', '.png', '.svg'].includes(ext)) return

    try {
      const imageUrl = await sync.uploadImage(filePath, latestInspectionId)

      if (ext === '.svg') {
        // SVG = graphics overlay (measurement lines, boxes, text)
        await sync.attachImage(latestInspectionId, null, imageUrl)
        await sync.log('info', 'bridge', `Graphics overlay linked to inspection`)
      } else {
        // BMP/JPG/PNG = camera image
        await sync.attachImage(latestInspectionId, imageUrl, null)
        await sync.log('info', 'bridge', `Camera image linked to inspection`)
      }
    } catch (err) {
      console.error('[Bridge] Image upload error:', err.message)
      await sync.log('error', 'bridge', `Image upload failed: ${err.message}`)
    }
  })

  try {
    await ftpServer.start()
    await sync.log('info', 'bridge', 'FTP server started for image reception')
  } catch (err) {
    console.error('[Bridge] FTP server error:', err.message)
    await sync.log('error', 'bridge', `FTP server failed: ${err.message}`)
  }

  // Start listening for commands
  sync.startCommandListener(handleCommand)

  // Heartbeat
  setInterval(() => sync.heartbeat(), HEARTBEAT_INTERVAL)

  // Periodic log cleanup
  setInterval(() => sync.cleanupLogs(), LOG_CLEANUP_INTERVAL)

  // Connect to camera
  try {
    await camera.connect()
  } catch (err) {
    console.error(`[Bridge] Initial connection failed: ${err.message}`)
    console.log('[Bridge] Will retry automatically...')
    await sync.log('warn', 'bridge', `Connection failed: ${err.message} — retrying...`)
    camera.scheduleReconnect()
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Bridge] Shutting down...')
  await sync.log('info', 'bridge', 'Bridge shutting down')
  sync.stop()
  camera.disconnect()
  logStream.end()
  await sync.updateStatus({ is_connected: false })
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await sync.log('info', 'bridge', 'Bridge terminated')
  sync.stop()
  camera.disconnect()
  logStream.end()
  await sync.updateStatus({ is_connected: false })
  process.exit(0)
})

main()
