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

// Track the latest inspection for image linking
let latestInspectionId = null
let latestInspectionResult = null
let latestMeasurements = {}

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

    // Mark zero measurements as failed (sin lectura) and override result
    let finalResult = result
    for (const key of Object.keys(measurements)) {
      if (measurements[key].value === 0) {
        measurements[key].pass = false
        finalResult = 'FAIL'
      }
    }

    const measureCount = Object.keys(measurements).length
    console.log(`[Bridge] Parsed VS Creator data: ${finalResult} | ${measureCount} measurements`)
    return { result: finalResult, program_number: null, model_name: null, raw_data: rawData, measurements }
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
// SVG graphics processing
// ============================================

/**
 * Filter and colorize Keyence VS Creator SVG graphics.
 *
 * Removes:
 *  - Tool[0001] (overall result display text)
 *  - Tool[0002] (pattern matching crosshairs)
 *  - All "Region" sections (ROI blue boxes)
 *
 * Keeps:
 *  - DetectedShape (detected circles)
 *  - DimensionLine (measurement lines)
 *  - TrendEdge (circle edge profile points)
 *  - PrimaryTarget (measurement edge indicators)
 *
 * Colors remaining graphics green (PASS) or red (FAIL).
 */
function processSvgGraphics(svgContent, result, measurements = {}) {
  const color = result === 'PASS' ? '#22c55e' : '#ef4444'

  // Split SVG into sections delimited by tool comments.
  // Capturing group keeps the delimiters in the array so we get
  // pairs: [header, comment, content, comment, content, ...]
  const sections = svgContent.split(/(<!--Tool\[\d+\]\.Output\.Graphic\.\w+-->)/)

  let output = sections[0] // Header: root <svg> tag

  // Track tool positions for measurement text labels
  const toolPositions = {} // toolNum -> { x, y }

  for (let i = 1; i < sections.length; i += 2) {
    const comment = sections[i]
    const content = sections[i + 1] || ''

    const match = comment.match(/<!--Tool\[(\d+)\]\.Output\.Graphic\.(\w+)-->/)
    if (!match) {
      output += comment + content
      continue
    }

    const toolNum = parseInt(match[1])
    const type = match[2]

    // Remove Tool[0001] (result text) and Tool[0002] (pattern matching)
    if (toolNum <= 2) continue

    // Remove Region sections (ROI boxes) from any tool
    if (type === 'Region') continue

    // Track center positions for DetectedShape and DimensionLine
    if (type === 'DetectedShape' && !toolPositions[toolNum]) {
      const translateMatch = content.match(/translate\(([\d.]+)\s+([\d.]+)\)/)
      if (translateMatch) {
        toolPositions[toolNum] = {
          x: parseFloat(translateMatch[1]),
          y: parseFloat(translateMatch[2]),
        }
      }
    }
    if (type === 'DimensionLine' && !toolPositions[toolNum]) {
      // Find midpoint of dimension line from path d="MX1,Y1 LX2,Y2" (trailing space before " is common)
      const pathMatch = content.match(/d="M([\d.]+),([\d.]+)\s+L([\d.]+),([\d.]+)\s*"/)
      if (pathMatch) {
        toolPositions[toolNum] = {
          x: (parseFloat(pathMatch[1]) + parseFloat(pathMatch[3])) / 2,
          y: (parseFloat(pathMatch[2]) + parseFloat(pathMatch[4])) / 2,
        }
      }
    }

    // Keep: DetectedShape, DimensionLine, TrendEdge, PrimaryTarget
    output += content
  }

  // Replace Keyence measurement colors with pass/fail color
  output = output.replaceAll('#87bb0c', color) // measurement green
  output = output.replaceAll('#ddb60e', color) // trend edge yellow

  // Make lines thicker for visibility
  output = output.replace(/stroke-width="2\.000"/g, 'stroke-width="10.000"')
  output = output.replace(/stroke-width="0\.600"/g, 'stroke-width="3.000"')
  // Make profile dots bigger
  output = output.replace(/r="2\.000"/g, 'r="8.000"')
  // Make arrow tips bigger
  output = output.replace(/-8\.000,-4\.800\s+-8\.000,4\.800/g, '-16.000,-9.600 -16.000,9.600')
  // Make crosshair points bigger
  output = output.replace(/-1\.000,-10\.000/g, '-2.000,-20.000')
  output = output.replace(/-1\.000,-1\.000/g, '-2.000,-2.000')
  output = output.replace(/-10\.000,-1\.000/g, '-20.000,-2.000')
  output = output.replace(/-10\.000,1\.000/g, '-20.000,2.000')
  output = output.replace(/-1\.000,1\.000/g, '-2.000,2.000')
  output = output.replace(/-1\.000,10\.000/g, '-2.000,20.000')
  output = output.replace(/1\.000,10\.000/g, '2.000,20.000')
  output = output.replace(/1\.000,1\.000/g, '2.000,2.000')
  output = output.replace(/10\.000,1\.000/g, '20.000,2.000')
  output = output.replace(/10\.000,-1\.000/g, '20.000,-2.000')
  output = output.replace(/1\.000,-1\.000/g, '2.000,-2.000')
  output = output.replace(/1\.000,-10\.000/g, '2.000,-20.000')

  // Inject measurement text labels at tool positions
  const measureKeys = Object.keys(measurements)
  const toolNums = Object.keys(toolPositions).map(Number).sort((a, b) => a - b)
  let textElements = ''

  // Place labels alternating above/below their measurement to avoid overlapping graphics
  // Sorted tool nums: [4, 5, 6, 7] mapped to measurements in order
  const offsets = [
    { dx: 100, dy: -350 },   // above (tool 4 - right circle)
    { dx: 100, dy: 250 },    // below (tool 5 - left circle)
    { dx: 200, dy: -350 },   // above (tool 6 - ancho)
    { dx: -900, dy: 250 },   // below-left (tool 7 - largo, shifted left to avoid tool 6)
    { dx: 100, dy: -350 },   // fallback
    { dx: 100, dy: 250 },    // fallback
  ]

  for (let i = 0; i < toolNums.length && i < measureKeys.length; i++) {
    const pos = toolPositions[toolNums[i]]
    const key = measureKeys[i]
    const m = measurements[key]
    const val = typeof m === 'object' ? m.value : m
    const unit = typeof m === 'object' ? (m.unit || 'mm') : 'mm'
    const isZero = val === 0 || val === '0'
    const label = isZero ? 'Sin lectura' : `${val} ${unit}`
    const labelColor = isZero ? '#ef4444' : color
    const off = offsets[i % offsets.length]

    // Name label, then value right below
    textElements += `<text x="${pos.x + off.dx}" y="${pos.y + off.dy}" font-family="Arial, sans-serif" font-size="70" fill="${labelColor}" stroke="#000000" stroke-width="3.5" paint-order="stroke" opacity="0.9">${key}</text>\n`
    textElements += `<text x="${pos.x + off.dx}" y="${pos.y + off.dy + 110}" font-family="Arial, sans-serif" font-size="130" font-weight="bold" fill="${labelColor}" stroke="#000000" stroke-width="6" paint-order="stroke">${label}</text>\n`
  }

  // Ensure root </svg> exists BEFORE inserting text labels.
  // The root </svg> may have been lost when Tool[0001]'s section was filtered out,
  // so we must add it first — otherwise lastIndexOf('</svg>') finds a nested one inside <defs>.
  if (!output.trimEnd().endsWith('</svg>')) {
    output += '\n</svg>\n'
  }

  // Now insert text labels before the root </svg> (guaranteed to be the last one)
  if (textElements) {
    const lastClose = output.lastIndexOf('</svg>')
    output = output.substring(0, lastClose) + textElements + output.substring(lastClose)
  }

  return output
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
    latestInspectionResult = inspection.result
    latestMeasurements = inspection.measurements || {}
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

    const inspectionId = latestInspectionId

    try {
      if (ext === '.svg') {
        // --- SVG graphics processing (unchanged) ---
        const uploadPath = filePath + '.processed.svg'
        let svg = fs.readFileSync(filePath, 'utf-8')

        const wMatch = svg.match(/width="(\d+)"/)
        const hMatch = svg.match(/height="(\d+)"/)
        const w = wMatch ? wMatch[1] : '4400'
        const h = hMatch ? hMatch[1] : '3296'

        svg = svg.replace(
          /<svg([^>]*?)>/,
          `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" overflow="visible" preserveAspectRatio="xMidYMid" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1">`
        )
        svg = svg.replace(/<image[^>]*\/>/g, '')
        svg = processSvgGraphics(svg, latestInspectionResult || 'FAIL', latestMeasurements)
        // Strip width/height from SVG root so CSS controls sizing in frontend
        const svgForOverlay = svg
          .replace(/<svg([^>]*)\s+width="[^"]*"/, '<svg$1')
          .replace(/<svg([^>]*)\s+height="[^"]*"/, '<svg$1')

        fs.writeFileSync(uploadPath, svg, 'utf-8')
        console.log(`[Bridge] SVG processed: filtered graphics, colored ${latestInspectionResult || 'FAIL'} (${w}x${h})`)

        // INSTANT: Broadcast SVG content directly to frontend
        await sync.broadcastGraphics(inspectionId, svgForOverlay)

        // PARALLEL: Upload SVG to Storage for persistence
        const imageUrl = await sync.uploadImage(uploadPath, inspectionId)
        await sync.attachImage(inspectionId, null, imageUrl)
        await sync.log('info', 'bridge', `Graphics overlay linked to inspection`)
      } else {
        // --- Camera photo: convert to JPEG, broadcast, upload ---
        const sharp = (await import('sharp')).default
        const rawBuffer = fs.readFileSync(filePath)
        let jpegBuffer

        try {
          jpegBuffer = await sharp(rawBuffer).jpeg({ quality: 85 }).toBuffer()
        } catch {
          // Sharp can't read Keyence BMP — parse raw pixels manually
          const width = rawBuffer.readInt32LE(18)
          const height = rawBuffer.readInt32LE(22)
          const bpp = rawBuffer.readUInt16LE(28)
          const dataOffset = rawBuffer.readUInt32LE(10)
          const absHeight = Math.abs(height)
          const rowSize = Math.ceil(width * (bpp / 8) / 4) * 4
          const channels = bpp / 8
          const pixels = Buffer.alloc(width * absHeight * 3)

          for (let y = 0; y < absHeight; y++) {
            const srcY = height > 0 ? (absHeight - 1 - y) : y
            const srcOff = dataOffset + srcY * rowSize
            const dstOff = y * width * 3
            for (let x = 0; x < width; x++) {
              const s = srcOff + x * channels
              pixels[dstOff + x * 3] = rawBuffer[s + 2]     // B → R
              pixels[dstOff + x * 3 + 1] = rawBuffer[s + 1] // G → G
              pixels[dstOff + x * 3 + 2] = rawBuffer[s]     // R → B
            }
          }

          jpegBuffer = await sharp(pixels, { raw: { width, height: absHeight, channels: 3 } })
            .jpeg({ quality: 85 })
            .toBuffer()
          console.log(`[Bridge] BMP parsed manually: ${width}x${absHeight} ${bpp}bpp`)
        }

        console.log(`[Bridge] Image converted to JPEG: ${(jpegBuffer.length / 1024).toFixed(0)}KB`)

        // INSTANT: Broadcast a smaller JPEG to stay under Supabase 1MB broadcast limit
        // Base64 adds ~33% overhead, so JPEG must be under ~700KB
        const broadcastJpeg = await sharp(jpegBuffer)
          .resize({ width: 1920, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer()
        console.log(`[Bridge] Broadcast JPEG: ${(broadcastJpeg.length / 1024).toFixed(0)}KB`)
        const base64 = broadcastJpeg.toString('base64')
        await sync.broadcastImage(inspectionId, `data:image/jpeg;base64,${base64}`)

        // PARALLEL: Upload JPEG to Storage for persistence
        const jpegPath = filePath.replace(/\.[^.]+$/, '.jpg')
        fs.writeFileSync(jpegPath, jpegBuffer)
        const imageUrl = await sync.uploadImage(jpegPath, inspectionId)
        await sync.attachImage(inspectionId, imageUrl, null)
        await sync.log('info', 'bridge', `Camera image linked to inspection`)
      }
    } catch (err) {
      console.error('[Bridge] Image processing error:', err.message)
      await sync.log('error', 'bridge', `Image processing failed: ${err.message}`)
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
