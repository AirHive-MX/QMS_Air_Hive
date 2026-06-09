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
// Optional spec fields — supported formats:
//
// Optional MODEL header (any format, comes right after the initial Task judgments):
//   Two-field pair "MODEL, <name>" lets the camera identify which program is active.
//   Without it, all specs are stored under model "DEFAULT" and collide across programs.
//   Example:  1,0,MODEL,PTR-4020,Perforación 1,12.087,1,12.000,0.500,...
//
// 1) TUPLE format (current Prolamsa setup, Vision Dashboard with 5 columns):
//      Each measurement is a contiguous tuple of 5 fields:
//        name, value, validation (0/1), nominal, tolerance
//      Example with 6 measurements (2 initial judgments + 30 fields = 32 total):
//        1,0,Perforación 1,12.087,1,12.000,0.500,Perforación 2,11.973,1,12.000,0.500,...
//
// 2) POSITIONAL trailing format (older Vision Dashboard layout):
//      Pairs (name, value) up front, then trailing: N judgments + 2N (nominal, tolerance) pairs
//      Example with 4 measurements:
//        1,0,Perforación 2,12.025,Perforación 1,12.001,Ancho,50.132,Largo,536.029,
//        1,1,1,1,12.000,5.000,12.000,5.000,50.000,5.000,536.000,5.000

// Suffix patterns for spec extraction (case-insensitive)
const SPEC_SUFFIX_RE = /^(.*?)_(USL|LSL|NOM|TOL)$/i

function classifyField(name) {
  const match = SPEC_SUFFIX_RE.exec(name)
  if (match) {
    return { type: 'spec', base: match[1].trim(), suffix: match[2].toUpperCase() }
  }
  if (/^(MODEL|PROGRAM|MODELO|PROGRAMA)$/i.test(name)) {
    return { type: 'model' }
  }
  return { type: 'measurement' }
}

// Pick a unit string from the measurement name. Anything matching "ángulo|angulo|angle" → °, else mm.
function unitForMeasurement(name) {
  return /[aá]ngulo|angle/i.test(name) ? '°' : 'mm'
}

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

    return { result, program_number: programNumber, model_name: modelName, raw_data: rawData, measurements, specs: [] }
  }

  // Format B (VS Creator real): mixed text labels + numeric values.
  // Two sub-flavors:
  //   a) Starts with numeric task judgments (1, 0, ...) — legacy
  //   b) Starts directly with text headers ("Elemento", "MODEL", measurement name, ...) — new
  // Both end up in the same parsing logic below.
  const firstVal = parseFloat(parts[0])
  {
    // Provisional result — will be overridden if "Resultado" field is sent,
    // or recomputed from per-measurement validations.
    const result = !isNaN(firstVal)
      ? (Math.round(firstVal) >= 1 ? 'PASS' : 'FAIL')
      : 'PASS'

    // Skip any leading numeric fields (legacy task judgments)
    let dataStart = 0
    while (dataStart < parts.length && !isNaN(parseFloat(parts[dataStart]))) {
      dataStart++
    }

    const measurements = {}
    const specsByBase = {}
    let modelFromOutput = null
    let sideFromOutput = null
    let resultFromOutput = null
    let dataParts = parts.slice(dataStart)

    // Optional MODEL header — if first two fields are "MODEL" + <model_name>,
    // strip them and remember the model. Lets users distinguish multiple programs
    // (e.g., PTR-4020 vs PTR-6030) so their specs don't collide in Supabase.
    if (
      dataParts.length >= 2 &&
      /^(MODEL|MODELO|PROGRAM|PROGRAMA)$/i.test(dataParts[0] || '')
    ) {
      modelFromOutput = (dataParts[1] || '').trim() || null
      dataParts = dataParts.slice(2)
    }

    // Optional COLUMN HEADER row — if first 5 fields are all text (e.g.,
    // "Elemento, Medida (mm), Validación, Nominal (mm), Tolerancia (mm)"),
    // skip them. They're just labels from the Vision Dashboard column headers.
    if (
      dataParts.length >= 10 &&
      dataParts.slice(0, 5).every((p) => p && isNaN(parseFloat(p)))
    ) {
      dataParts = dataParts.slice(5)
    }

    // Detect format:
    //   NEW (interleaved tuples of 5): name, value, validation, nominal, tolerance, ...
    //   OLD (paired then trailing):    name, value, name, value, ..., judgments, nominals/tolerances
    const isNewTupleFormat =
      dataParts.length >= 5 &&
      isNaN(parseFloat(dataParts[0])) &&    // name (text)
      !isNaN(parseFloat(dataParts[1])) &&   // value (number)
      !isNaN(parseFloat(dataParts[2]))      // validation (number) → NEW format

    if (isNewTupleFormat) {
      // Walk through fields and handle:
      //   (a) Metadata pairs at any position:  "Modelo, <name>"  |  "Lado, <side>"  |  "Resultado, <val>"
      //   (b) 5-tuples (name, value, validation, nominal, tolerance)
      let i = 0
      while (i < dataParts.length) {
        const name = dataParts[i]
        if (!name) { i++; continue }

        // Metadata pair (2 fields)
        if (/^(MODEL|MODELO|PROGRAM|PROGRAMA)$/i.test(name)) {
          modelFromOutput = String(dataParts[i + 1] || '').trim() || modelFromOutput
          i += 2
          continue
        }
        if (/^(LADO|SIDE)$/i.test(name)) {
          sideFromOutput = String(dataParts[i + 1] || '').trim() || null
          i += 2
          continue
        }
        if (/^(RESULTADO|RESULT|RESULTS?)$/i.test(name)) {
          resultFromOutput = String(dataParts[i + 1] || '').trim() || null
          i += 2
          continue
        }

        // 5-tuple measurement
        if (i + 4 >= dataParts.length) break // not enough fields left
        const value = parseFloat(dataParts[i + 1])
        const validation = parseFloat(dataParts[i + 2])
        const nominal = parseFloat(dataParts[i + 3])
        const tolerance = parseFloat(dataParts[i + 4])
        if (isNaN(value)) { i++; continue }

        // FILTER: when value === 0, this measurement is "not for this side"
        // (per user spec — Vision Dashboard auto-zeros measurements that don't apply to the
        // currently identified side). Skip these completely from the HMI.
        if (value === 0) {
          i += 5
          continue
        }

        measurements[name] = {
          value: parseFloat(value.toFixed(3)),
          unit: unitForMeasurement(name),
          pass: !isNaN(validation) ? validation >= 1 : true,
        }
        if (!isNaN(nominal)) {
          if (!specsByBase[name]) specsByBase[name] = {}
          specsByBase[name].nominal = nominal
          if (!isNaN(tolerance)) specsByBase[name].tol = tolerance
        }
        i += 5
      }

      // Decide final result:
      //   If "Resultado" was sent explicitly, use it (1/+1.000/TRUE = PASS, else FAIL)
      //   Otherwise compute from measurements (any FAIL → FAIL)
      let finalResult
      if (resultFromOutput != null) {
        const r = resultFromOutput.toUpperCase()
        const asNum = parseFloat(resultFromOutput)
        const isPass =
          r === 'TRUE' || r === 'OK' || r === 'PASS' ||
          (!isNaN(asNum) && asNum >= 1)
        finalResult = isPass ? 'PASS' : 'FAIL'
      } else {
        finalResult = Object.values(measurements).every((m) => m.pass) ? 'PASS' : 'FAIL'
      }

      // Resolve specs: derive USL/LSL from NOM+TOL
      const specs = []
      for (const [base, s] of Object.entries(specsByBase)) {
        if (!measurements[base]) continue
        let { usl, lsl, nominal, tol } = s
        if (nominal != null && tol != null) {
          if (usl == null) usl = +(nominal + tol).toFixed(4)
          if (lsl == null) lsl = +(nominal - tol).toFixed(4)
        }
        specs.push({ measurement_name: base, nominal, usl, lsl, unit: unitForMeasurement(base) })
      }

      // Combine Modelo + Lado into model_name so each side gets its own specs row in Supabase.
      // e.g., "Pieza A / Side 1", "Pieza A / Side 2", "Pieza B / Side 1", ...
      const combinedModel =
        modelFromOutput && sideFromOutput
          ? `${modelFromOutput} / ${sideFromOutput}`
          : (modelFromOutput || sideFromOutput || null)

      const measureCount = Object.keys(measurements).length
      console.log(
        `[Bridge] Parsed VS Creator data (tuple format): ${finalResult} | ${measureCount} measurements` +
        (specs.length ? ` | ${specs.length} specs` : '') +
        (combinedModel ? ` | model="${combinedModel}"` : '')
      )
      return {
        result: finalResult,
        program_number: null,
        model_name: combinedModel,
        raw_data: rawData,
        measurements,
        specs,
      }
    }

    // ── Legacy OLD format from here ──
    // Check if remaining data has text+value pairs (name,value,name,value,...)
    // Trailing numeric values after pairs are per-tool judgments (1=OK, 0=NG)
    const trailingJudgments = []
    if (dataParts.length >= 2 && isNaN(parseFloat(dataParts[0]))) {
      // Paired format: label, value, label, value, ... [judgment, judgment, ...]
      for (let i = 0; i < dataParts.length - 1; i += 2) {
        const name = dataParts[i]
        // If "name" is numeric, we've reached trailing values:
        //   - First N are per-tool judgments (0 or 1)
        //   - Next 2N (optional) are (nominal, tolerance) pairs — must keep as floats
        if (!isNaN(parseFloat(name))) {
          for (let j = i; j < dataParts.length; j++) {
            trailingJudgments.push(parseFloat(dataParts[j]))
          }
          break
        }
        const rawVal = dataParts[i + 1]
        const classified = classifyField(name)

        if (classified.type === 'model') {
          modelFromOutput = (rawVal || '').trim() || null
          continue
        }

        const val = parseFloat(rawVal)
        if (!name || isNaN(val)) continue

        if (classified.type === 'spec') {
          const base = classified.base
          if (!specsByBase[base]) specsByBase[base] = {}
          if (classified.suffix === 'USL') specsByBase[base].usl = val
          else if (classified.suffix === 'LSL') specsByBase[base].lsl = val
          else if (classified.suffix === 'NOM') specsByBase[base].nominal = val
          else if (classified.suffix === 'TOL') specsByBase[base].tol = val
        } else {
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

    // Apply per-tool judgments from trailing values (1=OK, 0=NG)
    // Format: first N trailing numbers = judgments, then optional 2N more = (nominal, tolerance) pairs
    const measureKeys = Object.keys(measurements)
    const N = measureKeys.length
    if (trailingJudgments.length > 0 && N > 0) {
      for (let i = 0; i < N && i < trailingJudgments.length; i++) {
        measurements[measureKeys[i]].pass = trailingJudgments[i] >= 1
      }

      // Positional specs format (configured in Vision Dashboard):
      // After N judgments, the next 2N numbers are (nominal, tolerance) per measurement
      // in the same order as the named measurements.
      const remainder = trailingJudgments.slice(N)
      if (remainder.length >= 2 * N && N > 0) {
        for (let i = 0; i < N; i++) {
          const nominal = remainder[i * 2]
          const tolerance = remainder[i * 2 + 1]
          if (nominal == null || isNaN(nominal)) continue
          const base = measureKeys[i]
          if (!specsByBase[base]) specsByBase[base] = {}
          specsByBase[base].nominal = nominal
          if (tolerance != null && !isNaN(tolerance)) {
            specsByBase[base].tol = tolerance
          }
        }
      }
    }

    // Mark zero measurements as failed (sin lectura) and override result
    let finalResult = result
    for (const key of measureKeys) {
      if (measurements[key].value === 0) {
        measurements[key].pass = false
        finalResult = 'FAIL'
      }
    }

    // Resolve specs: if NOM+TOL given, derive USL/LSL. Output array of { measurement_name, ... }
    const specs = []
    for (const [base, s] of Object.entries(specsByBase)) {
      // Only include specs whose base name matches a real measurement (avoids stray fields)
      if (!measurements[base]) continue
      let { usl, lsl, nominal, tol } = s
      if (nominal != null && tol != null) {
        if (usl == null) usl = +(nominal + tol).toFixed(4)
        if (lsl == null) lsl = +(nominal - tol).toFixed(4)
      }
      if (nominal == null && usl != null && lsl != null) {
        nominal = +((usl + lsl) / 2).toFixed(4)
      }
      specs.push({ measurement_name: base, nominal, usl, lsl, unit: 'mm' })
    }

    const measureCount = Object.keys(measurements).length
    const specCount = specs.length
    console.log(
      `[Bridge] Parsed VS Creator data: ${finalResult} | ${measureCount} measurements` +
      (specCount ? ` | ${specCount} specs` : '') +
      (modelFromOutput ? ` | model="${modelFromOutput}"` : '')
    )
    return {
      result: finalResult,
      program_number: null,
      model_name: modelFromOutput,
      raw_data: rawData,
      measurements,
      specs,
    }
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
    specs: [],
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
  const fallbackColor = result === 'PASS' ? '#22c55e' : '#ef4444'

  // Split SVG into sections delimited by tool comments.
  const sections = svgContent.split(/(<!--Tool\[\d+\]\.Output\.Graphic\.\w+-->)/)

  let output = sections[0] // Header: root <svg> tag

  // Track tool positions for measurement text labels
  const toolPositions = {} // toolNum -> { x, y }

  // First pass: collect kept sections, tool positions, and tool types
  const keptSections = [] // { toolNum, content }
  const toolTypeMap = {}  // toolNum -> 'circle' | 'line'

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

    // Skip TrendEdge entirely (circle edge detection lines/dots)
    if (type === 'TrendEdge') continue

    // Classify tool type and track positions
    // Helper: extract first translate(x y) from any content
    const extractTranslatePos = (c) => {
      const m = c.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/)
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null
    }

    if (type === 'DetectedShape') {
      toolTypeMap[toolNum] = 'circle'
      if (!toolPositions[toolNum]) {
        const pos = extractTranslatePos(content)
        if (pos) toolPositions[toolNum] = pos
      }
    }
    if (type === 'DimensionLine') {
      if (!toolTypeMap[toolNum]) toolTypeMap[toolNum] = 'line'
      if (!toolPositions[toolNum]) {
        const pathMatch = content.match(/d="M([\d.]+),([\d.]+)\s+L([\d.]+),([\d.]+)\s*"/)
        if (pathMatch) {
          toolPositions[toolNum] = {
            x: (parseFloat(pathMatch[1]) + parseFloat(pathMatch[3])) / 2,
            y: (parseFloat(pathMatch[2]) + parseFloat(pathMatch[4])) / 2,
          }
        } else {
          // Fallback to translate() if no path found
          const pos = extractTranslatePos(content)
          if (pos) toolPositions[toolNum] = pos
        }
      }
    }
    // Angle tool ("Ángulo formado por dos líneas"): emits AngleAuxiliaryLine (arc at vertex)
    // and Target (the two lines that form the angle). The arc's translate() is the vertex.
    if (type === 'AngleAuxiliaryLine') {
      toolTypeMap[toolNum] = 'angle'
      if (!toolPositions[toolNum]) {
        const pos = extractTranslatePos(content)
        if (pos) toolPositions[toolNum] = pos
      }
    }

    keptSections.push({ toolNum, content })
  }

  // Build tool→measurement mapping (always type-aware, not just sequential):
  //   Tool numbers can be interleaved (e.g., 4,5,6,7,13,14,16 mixing circle and line tools)
  //   while measurements come in TCP order. Map by TYPE to avoid mis-mapping.
  const measureKeys = Object.keys(measurements)
  const toolNums = Object.keys(toolPositions).map(Number).sort((a, b) => a - b)
  const toolToMeasureIdx = {}

  const circleTools = toolNums.filter((n) => toolTypeMap[n] === 'circle').sort((a, b) => a - b)
  const lineTools = toolNums.filter((n) => toolTypeMap[n] === 'line').sort((a, b) => a - b)
  const angleTools = toolNums.filter((n) => toolTypeMap[n] === 'angle').sort((a, b) => a - b)

  // Classify measurements by name keyword:
  //   "perforación/circle/radio/diámetro/hole" → circle
  //   "ángulo/angulo/angle"                    → angle
  //   anything else                            → line (default)
  const circlePattern = /radio|circulo|círculo|circle|diametro|diámetro|diameter|perforaci[oó]n|perforation|hole|agujero/i
  const anglePattern = /[aá]ngulo|angle/i
  const circleMeasIdxs = []
  const lineMeasIdxs = []
  const angleMeasIdxs = []
  measureKeys.forEach((key, idx) => {
    if (anglePattern.test(key)) angleMeasIdxs.push(idx)
    else if (circlePattern.test(key)) circleMeasIdxs.push(idx)
    else lineMeasIdxs.push(idx)
  })

  // Map by type, preserving order within each group
  for (let i = 0; i < circleTools.length && i < circleMeasIdxs.length; i++) {
    toolToMeasureIdx[circleTools[i]] = circleMeasIdxs[i]
  }
  for (let i = 0; i < lineTools.length && i < lineMeasIdxs.length; i++) {
    toolToMeasureIdx[lineTools[i]] = lineMeasIdxs[i]
  }
  for (let i = 0; i < angleTools.length && i < angleMeasIdxs.length; i++) {
    toolToMeasureIdx[angleTools[i]] = angleMeasIdxs[i]
  }

  console.log(`[Bridge] SVG tool mapping (${toolNums.length} tools, ${measureKeys.length} measurements):`,
    toolNums.map((n) => `Tool${n}(${toolTypeMap[n] || '?'})→${measureKeys[toolToMeasureIdx[n]] || '?'}`).join(', '))

  // Second pass: apply per-tool coloring and append to output
  for (const { toolNum, content } of keptSections) {
    const mIdx = toolToMeasureIdx[toolNum]
    let toolColor = fallbackColor
    if (mIdx !== undefined && mIdx < measureKeys.length) {
      const m = measurements[measureKeys[mIdx]]
      const pass = typeof m === 'object' ? m.pass : true
      toolColor = pass ? '#22c55e' : '#ef4444'
    }

    let colored = content.replaceAll('#87bb0c', toolColor)
    colored = colored.replaceAll('#ddb60e', toolColor)
    output += colored
  }

  // Make lines thicker for visibility
  output = output.replace(/stroke-width="2\.000"/g, 'stroke-width="18.000"')
  output = output.replace(/stroke-width="0\.600"/g, 'stroke-width="6.000"')
  // Make profile dots bigger
  output = output.replace(/r="2\.000"/g, 'r="10.000"')
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

  // Inject measurement text labels near tool positions with collision avoidance
  let textElements = ''

  // Step 1: Build label data with initial placement (alternate above/below tool)
  const labelData = []
  for (let i = 0; i < toolNums.length; i++) {
    const tn = toolNums[i]
    const mIdx = toolToMeasureIdx[tn]
    if (mIdx === undefined || mIdx >= measureKeys.length) continue
    const pos = toolPositions[tn]
    const key = measureKeys[mIdx]
    const m = measurements[key]
    const val = typeof m === 'object' ? m.value : m
    const unit = typeof m === 'object' ? (m.unit || 'mm') : 'mm'
    const isZero = val === 0 || val === '0'
    const label = isZero ? 'Sin lectura' : `${val} ${unit}`
    const pass = typeof m === 'object' ? m.pass : true
    const labelColor = (isZero || !pass) ? '#ef4444' : '#22c55e'

    // Initial offset: alternate above (-500) and below (+400) the tool position
    const above = (i % 2 === 0)
    const dy = above ? -500 : 400
    const dx = 100

    labelData.push({
      x: pos.x + dx,
      y: pos.y + dy,
      key,
      label,
      labelColor,
      width: Math.max(key.length, label.length) * 72, // approximate px width
    })
  }

  // Step 2: Resolve overlaps — push labels apart vertically until none overlap
  const LABEL_H = 320 // height of name + value + padding
  for (let iter = 0; iter < 10; iter++) {
    let moved = false
    for (let a = 0; a < labelData.length; a++) {
      for (let b = a + 1; b < labelData.length; b++) {
        const la = labelData[a]
        const lb = labelData[b]
        // Check X overlap (labels at very different X don't collide)
        const xOverlap = Math.abs(la.x - lb.x) < Math.min(la.width, lb.width) * 0.7
        // Check Y overlap
        const yGap = Math.abs(la.y - lb.y)
        if (xOverlap && yGap < LABEL_H) {
          // Push apart: move each label half the needed distance
          const push = (LABEL_H - yGap) / 2 + 10
          if (la.y <= lb.y) {
            la.y -= push
            lb.y += push
          } else {
            la.y += push
            lb.y -= push
          }
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // Step 3: Clamp labels within SVG bounds (0..4400 x 0..3296)
  for (const l of labelData) {
    if (l.y < 140) l.y = 140  // keep name text visible (font-size 120)
    if (l.y + 145 > 3250) l.y = 3250 - 145  // keep value text visible
    if (l.x < 10) l.x = 10
    if (l.x + l.width > 4390) l.x = 4390 - l.width
  }

  // Step 4: Render labels
  for (const l of labelData) {
    textElements += `<text x="${l.x}" y="${l.y}" font-family="Arial, sans-serif" font-size="120" fill="${l.labelColor}" stroke="#000000" stroke-width="5" paint-order="stroke" opacity="0.9">${l.key}</text>\n`
    textElements += `<text x="${l.x}" y="${l.y + 145}" font-family="Arial, sans-serif" font-size="130" font-weight="bold" fill="${l.labelColor}" stroke="#000000" stroke-width="5.5" paint-order="stroke">${l.label}</text>\n`
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

  const parsed = parseInspectionData(data)
  if (parsed) {
    // Separate specs (not stored on inspection row) from the inspection payload
    const { specs, ...inspection } = parsed
    const saved = await sync.saveInspection(inspection)
    latestInspectionId = saved.id
    latestInspectionResult = inspection.result
    latestMeasurements = inspection.measurements || {}
    await sync.log('info', 'bridge', `Inspection saved: ${inspection.result}`)

    // Auto-upsert measurement specs if VS Creator pushed them
    if (specs?.length) {
      const modelForSpecs = inspection.model_name || 'DEFAULT'
      await sync.upsertMeasurementSpecs(modelForSpecs, specs)
      await sync.log('info', 'bridge', `Specs synced: ${specs.length} for model "${modelForSpecs}"`)
    }
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
        const t0 = Date.now()
        const sharp = (await import('sharp')).default
        const rawBuffer = fs.readFileSync(filePath)

        // Build a Sharp pipeline source — either by handing Sharp the BMP directly,
        // or by extracting the raw pixel data and letting Sharp do the BGR→RGB swap natively.
        let pipelineFactory
        let isManualBmp = false
        try {
          // Quick capability test (throws if Sharp can't read this BMP variant)
          await sharp(rawBuffer).metadata()
          pipelineFactory = () => sharp(rawBuffer)
        } catch {
          // Keyence BMP: parse header and hand Sharp the raw pixel data.
          const width = rawBuffer.readInt32LE(18)
          const height = rawBuffer.readInt32LE(22)
          const bpp = rawBuffer.readUInt16LE(28)
          const dataOffset = rawBuffer.readUInt32LE(10)
          const absHeight = Math.abs(height)
          const channels = bpp / 8
          const rowSize = Math.ceil(width * channels / 4) * 4
          const unpaddedRowSize = width * channels

          // Strip BMP row padding using native Buffer.copy (orders of magnitude faster than per-byte JS loop)
          let packedBgr
          if (rowSize === unpaddedRowSize) {
            // No padding — zero-copy slice into raw buffer
            packedBgr = rawBuffer.subarray(dataOffset, dataOffset + rowSize * absHeight)
          } else {
            packedBgr = Buffer.allocUnsafe(unpaddedRowSize * absHeight)
            for (let y = 0; y < absHeight; y++) {
              rawBuffer.copy(packedBgr, y * unpaddedRowSize, dataOffset + y * rowSize, dataOffset + y * rowSize + unpaddedRowSize)
            }
          }

          // Sharp handles BGR→RGB swap + vertical flip natively (in C++, ~50x faster than JS loop)
          pipelineFactory = () => {
            let p = sharp(packedBgr, { raw: { width, height: absHeight, channels: 3 } })
            if (height > 0) p = p.flip() // BMP is bottom-up
            return p.recomb([[0, 0, 1], [0, 1, 0], [1, 0, 0]]) // swap R↔B
          }
          isManualBmp = true
          console.log(`[Bridge] BMP header parsed: ${width}x${absHeight} ${bpp}bpp${rowSize === unpaddedRowSize ? '' : ' (padded)'}`)
        }

        // Broadcast version: small + fast (single Sharp pipeline, native operations)
        const broadcastJpeg = await pipelineFactory()
          .resize({ width: 1920, withoutEnlargement: true })
          .jpeg({ quality: 70, mozjpeg: true })
          .toBuffer()
        const t1 = Date.now()
        console.log(`[Bridge] Broadcast JPEG: ${(broadcastJpeg.length / 1024).toFixed(0)}KB in ${t1 - t0}ms`)

        // FIRE broadcast immediately — don't await before kicking off Storage upload
        const broadcastPromise = sync.broadcastImage(
          inspectionId,
          `data:image/jpeg;base64,${broadcastJpeg.toString('base64')}`
        )

        // Storage upload runs in parallel: produce full-res JPEG and upload
        const storagePromise = (async () => {
          const fullJpeg = await pipelineFactory().jpeg({ quality: 85, mozjpeg: true }).toBuffer()
          const jpegPath = filePath.replace(/\.[^.]+$/, '.jpg')
          fs.writeFileSync(jpegPath, fullJpeg)
          const imageUrl = await sync.uploadImage(jpegPath, inspectionId)
          await sync.attachImage(inspectionId, imageUrl, null)
          console.log(`[Bridge] Storage upload done in ${Date.now() - t0}ms total`)
        })()

        // Await both, but the broadcast happens MUCH earlier (HMI sees image right away)
        await Promise.allSettled([broadcastPromise, storagePromise])
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
