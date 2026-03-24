import net from 'node:net'

/**
 * MockCamera - Simulates a Keyence VS Series camera
 * for development and testing without hardware.
 *
 * Listens on TCP port 8500 and responds to commands.
 * After each TRG command, sends simulated inspection data.
 */

const PORT = parseInt(process.env.CAMERA_PORT || '8500', 10)
const DELIMITER = '\r'

// Simulated measurement specs for a steel profile with holes
const SPECS = {
  'Largo': { nominal: 254.0, tolerance: 1.0, unit: 'mm' },
  'Ancho': { nominal: 127.0, tolerance: 0.5, unit: 'mm' },
  'Espesor': { nominal: 3.2, tolerance: 0.15, unit: 'mm' },
  'Hoyo_1_diametro': { nominal: 12.5, tolerance: 0.3, unit: 'mm' },
  'Hoyo_2_diametro': { nominal: 12.5, tolerance: 0.3, unit: 'mm' },
  'Hoyo_1_posX': { nominal: 50.0, tolerance: 0.5, unit: 'mm' },
  'Hoyo_2_posX': { nominal: 200.0, tolerance: 0.5, unit: 'mm' },
}

const MODEL_NAMES = ['Perfil-A001', 'Perfil-B002', 'Perfil-C003']

let triggerCount = 0

function generateMeasurement(spec) {
  // 80% chance within tolerance, 20% chance slightly out
  const withinTol = Math.random() > 0.2
  let deviation

  if (withinTol) {
    deviation = (Math.random() - 0.5) * spec.tolerance * 1.5
  } else {
    // Out of tolerance
    const sign = Math.random() > 0.5 ? 1 : -1
    deviation = sign * spec.tolerance * (1.2 + Math.random() * 0.8)
  }

  const value = Math.round((spec.nominal + deviation) * 1000) / 1000
  const pass = Math.abs(value - spec.nominal) <= spec.tolerance

  return { value, pass, unit: spec.unit }
}

function generateInspectionData() {
  const measurements = {}
  let allPass = true

  for (const [name, spec] of Object.entries(SPECS)) {
    const m = generateMeasurement(spec)
    measurements[name] = m
    if (!m.pass) allPass = false
  }

  const modelName = MODEL_NAMES[triggerCount % MODEL_NAMES.length]
  const programNumber = (triggerCount % MODEL_NAMES.length) + 1

  // Format: result,program,model,dim1,dim2,...
  const values = Object.values(measurements).map((m) => m.value)
  const result = allPass ? 'PASS' : 'FAIL'
  const csvLine = [result, programNumber, modelName, ...values].join(',')

  return { csvLine, measurements, result, modelName, programNumber }
}

const server = net.createServer((socket) => {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`
  console.log(`[MockCamera] Client connected: ${addr}`)

  let buffer = ''

  socket.on('data', (data) => {
    buffer += data.toString()

    let delimIndex
    while ((delimIndex = buffer.indexOf(DELIMITER)) !== -1) {
      const command = buffer.substring(0, delimIndex).trim()
      buffer = buffer.substring(delimIndex + DELIMITER.length)

      if (!command) continue

      console.log(`[MockCamera] Received: ${command}`)
      handleCommand(socket, command)
    }
  })

  socket.on('close', () => {
    console.log(`[MockCamera] Client disconnected: ${addr}`)
  })

  socket.on('error', (err) => {
    console.error(`[MockCamera] Socket error: ${err.message}`)
  })
})

function handleCommand(socket, command) {
  const parts = command.split(',')
  const cmd = parts[0].toUpperCase()

  switch (cmd) {
    case 'TRG': {
      // Respond to trigger
      socket.write(`TRG${DELIMITER}`)
      triggerCount++

      // After a short delay, send inspection data
      setTimeout(() => {
        const { csvLine } = generateInspectionData()
        console.log(`[MockCamera] Inspection #${triggerCount}: ${csvLine}`)
        socket.write(csvLine + DELIMITER)
      }, 200 + Math.random() * 300)
      break
    }

    case 'MOR':
      socket.write(`MOR,1${DELIMITER}`) // Always in Run mode
      break

    case 'HMR':
      socket.write(`HMR,VS-S500MJ${DELIMITER}`)
      break

    case 'FVR':
      socket.write(`FVR,1.6.0001${DELIMITER}`)
      break

    case 'EC':
      socket.write(`EC,${parts[1] || '0'}${DELIMITER}`)
      break

    case 'RUN':
      socket.write(`RUN${DELIMITER}`)
      break

    case 'SET':
      socket.write(`SET${DELIMITER}`)
      break

    case 'RS':
      triggerCount = 0
      socket.write(`RS${DELIMITER}`)
      break

    case 'PR':
      socket.write(`PR,1,0001${DELIMITER}`)
      break

    case 'TD':
      socket.write(`TD${DELIMITER}`)
      break

    case 'TSR':
      socket.write(`TSR,0${DELIMITER}`)
      break

    default:
      socket.write(`ER,${cmd},01${DELIMITER}`)
      break
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[MockCamera] Keyence VS simulator listening on port ${PORT}`)
  console.log(`[MockCamera] Connect with: telnet 127.0.0.1 ${PORT}`)
  console.log('[MockCamera] Available commands: TRG, MOR, HMR, FVR, EC, RUN, SET, RS, PR')
})

server.on('error', (err) => {
  console.error(`[MockCamera] Server error: ${err.message}`)
  process.exit(1)
})
