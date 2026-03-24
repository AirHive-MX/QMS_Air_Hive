import 'dotenv/config'
import { KeyenceClient } from './keyence-client.js'
import { SupabaseSync } from './supabase-sync.js'

// ============================================
// Configuration
// ============================================

const CAMERA_IP = process.env.CAMERA_IP || '127.0.0.1'
const CAMERA_PORT = parseInt(process.env.CAMERA_PORT || '8500', 10)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const HEARTBEAT_INTERVAL = 15000 // 15 seconds

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[Bridge] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
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

// ============================================
// Parse inspection data from camera
// ============================================

// The measurement names correspond to what's configured in VS Creator
// Data Output (Non-Procedural) tool. This mapping should match.
const MEASUREMENT_NAMES = [
  'Largo', 'Ancho', 'Espesor',
  'Hoyo_1_diametro', 'Hoyo_2_diametro',
  'Hoyo_1_posX', 'Hoyo_2_posX',
]

function parseInspectionData(rawData) {
  // Expected format from mock: result,programNumber,modelName,val1,val2,...
  // Real camera format depends on VS Creator Data Output configuration
  const parts = rawData.split(',')

  if (parts.length < 3) {
    console.warn('[Bridge] Unexpected data format:', rawData)
    return null
  }

  const result = parts[0].toUpperCase() === 'PASS' ? 'PASS' : 'FAIL'
  const programNumber = parseInt(parts[1], 10) || null
  const modelName = parts[2] || null
  const values = parts.slice(3).map(Number)

  const measurements = {}
  values.forEach((val, idx) => {
    const name = MEASUREMENT_NAMES[idx] || `dim_${idx}`
    measurements[name] = {
      value: val,
      unit: 'mm',
      pass: true, // In real use, VS Creator sends per-tool judgments
    }
  })

  return {
    result,
    program_number: programNumber,
    model_name: modelName,
    raw_data: rawData,
    measurements,
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
  } catch (err) {
    console.error('[Bridge] Error getting camera info:', err.message)
  }
})

camera.on('disconnected', async () => {
  await sync.updateStatus({ is_connected: false })
})

camera.on('inspection-data', async (data) => {
  console.log(`[Bridge] Inspection data received: ${data}`)
  const inspection = parseInspectionData(data)
  if (inspection) {
    await sync.saveInspection(inspection)
  }
})

camera.on('error', (err) => {
  console.error('[Bridge] Camera error:', err.message)
})

// ============================================
// Command handler
// ============================================

async function handleCommand(command) {
  console.log(`[Bridge] Processing command: ${command.command}`)

  switch (command.command.toUpperCase()) {
    case 'TRG':
      await camera.trigger()
      break
    case 'RUN':
      await camera.switchToRun()
      cameraInfo.mode = 'RUN'
      await sync.updateStatus({ camera_mode: 'RUN' })
      break
    case 'SET':
      await camera.switchToSetup()
      cameraInfo.mode = 'SETUP'
      await sync.updateStatus({ camera_mode: 'SETUP' })
      break
    case 'RS':
      await camera.reset()
      break
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

  // Start listening for commands
  sync.startCommandListener(handleCommand)

  // Heartbeat
  setInterval(() => sync.heartbeat(), HEARTBEAT_INTERVAL)

  // Connect to camera
  try {
    await camera.connect()
  } catch (err) {
    console.error(`[Bridge] Initial connection failed: ${err.message}`)
    console.log('[Bridge] Will retry automatically...')
    camera.scheduleReconnect()
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Bridge] Shutting down...')
  sync.stop()
  camera.disconnect()
  await sync.updateStatus({ is_connected: false })
  process.exit(0)
})

process.on('SIGTERM', async () => {
  sync.stop()
  camera.disconnect()
  await sync.updateStatus({ is_connected: false })
  process.exit(0)
})

main()
