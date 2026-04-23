// Demo data for client presentation — all data is fictitious

export const operators = [
  { id: 'op1', name: 'Carlos Mendoza', shift: 'Turno 1 (6:00 - 14:00)', badge: 'OP-1042', avatar: 'CM' },
  { id: 'op2', name: 'Ana García', shift: 'Turno 1 (6:00 - 14:00)', badge: 'OP-1018', avatar: 'AG' },
  { id: 'op3', name: 'Roberto Sánchez', shift: 'Turno 2 (14:00 - 22:00)', badge: 'OP-1055', avatar: 'RS' },
  { id: 'op4', name: 'María López', shift: 'Turno 2 (14:00 - 22:00)', badge: 'OP-1033', avatar: 'ML' },
  { id: 'op5', name: 'Luis Hernández', shift: 'Turno 3 (22:00 - 6:00)', badge: 'OP-1067', avatar: 'LH' },
]

const models = ['PTR-4020', 'PTR-6030', 'PTR-8040', 'PTR-3015', 'PTR-10050']
const machines = ['CNC-01', 'CNC-02', 'CNC-03', 'CNC-04']
const defectTypes = [
  'Radio fuera de tolerancia',
  'Sin lectura de circulo',
  'Ancho fuera de rango',
  'Largo incorrecto',
  'Doble perforacion',
  'Desalineamiento',
]

function randomBetween(min, max) {
  return +(min + Math.random() * (max - min)).toFixed(3)
}

function generateInspections(operatorId, count, passRate) {
  const inspections = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const passed = Math.random() < passRate
    const model = models[Math.floor(Math.random() * models.length)]
    const machine = machines[Math.floor(Math.random() * machines.length)]
    const ts = new Date(now - i * 3 * 60 * 1000 - Math.random() * 60000)
    inspections.push({
      id: `${operatorId}-${i}`,
      created_at: ts.toISOString(),
      result: passed ? 'PASS' : 'FAIL',
      model_name: model,
      machine,
      measurements: {
        'Radio Circulo Izq': { value: passed ? randomBetween(11.5, 11.9) : randomBetween(0, 11.2), unit: 'mm', pass: passed || Math.random() > 0.5 },
        'Radio Circulo Der': { value: passed ? randomBetween(11.5, 11.9) : 0, unit: 'mm', pass: passed },
        'Medicion Ancho': { value: randomBetween(48.0, 49.0), unit: 'mm', pass: true },
        'Medicion Largo': { value: randomBetween(515.0, 517.0), unit: 'mm', pass: true },
      },
      defect: passed ? null : defectTypes[Math.floor(Math.random() * defectTypes.length)],
    })
  }
  return inspections
}

// Pre-generate inspections for each operator
export const operatorInspections = {
  op1: generateInspections('op1', 45, 0.89),
  op2: generateInspections('op2', 38, 0.92),
  op3: generateInspections('op3', 52, 0.85),
  op4: generateInspections('op4', 30, 0.93),
  op5: generateInspections('op5', 41, 0.78),
}

// Dashboard aggregate metrics
const allInspections = Object.values(operatorInspections).flat()
const totalCount = allInspections.length
const failCount = allInspections.filter(i => i.result === 'FAIL').length
const passCount = totalCount - failCount

export const dashboardKPIs = {
  totalInspections: totalCount,
  passCount,
  failCount,
  passRate: +((passCount / totalCount) * 100).toFixed(1),
  rejectRate: +((failCount / totalCount) * 100).toFixed(1),
  piecesPerHour: +(totalCount / 8).toFixed(1),
  avgCycleTime: '4.2s',
}

// Pareto: defect frequency
export const paretoData = (() => {
  const counts = {}
  allInspections.filter(i => i.defect).forEach(i => {
    counts[i.defect] = (counts[i.defect] || 0) + 1
  })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((s, [, v]) => s + v, 0)
  let cumulative = 0
  return sorted.map(([name, count]) => {
    cumulative += count
    return { name, count, percent: +((count / total) * 100).toFixed(1), cumPercent: +((cumulative / total) * 100).toFixed(1) }
  })
})()

// By machine
export const machineData = machines.map(m => {
  const items = allInspections.filter(i => i.machine === m)
  const fails = items.filter(i => i.result === 'FAIL').length
  return { machine: m, total: items.length, fails, rate: items.length ? +((fails / items.length) * 100).toFixed(1) : 0 }
}).sort((a, b) => b.rate - a.rate)

// By operator
export const operatorPerformance = operators.map(op => {
  const items = operatorInspections[op.id]
  const fails = items.filter(i => i.result === 'FAIL').length
  return { name: op.name, total: items.length, fails, passRate: items.length ? +(((items.length - fails) / items.length) * 100).toFixed(1) : 0 }
}).sort((a, b) => b.passRate - a.passRate)

// By model
export const modelData = models.map(m => {
  const items = allInspections.filter(i => i.model_name === m)
  const fails = items.filter(i => i.result === 'FAIL').length
  return { model: m, total: items.length, fails, passRate: items.length ? +(((items.length - fails) / items.length) * 100).toFixed(1) : 0 }
}).sort((a, b) => a.passRate - b.passRate)

// Daily trend (last 7 days)
export const dailyTrend = (() => {
  const days = []
  for (let d = 6; d >= 0; d--) {
    const date = new Date()
    date.setDate(date.getDate() - d)
    const label = date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
    const total = 25 + Math.floor(Math.random() * 20)
    const fails = 2 + Math.floor(Math.random() * 6)
    days.push({ label, total, fails, pass: total - fails, rate: +(((total - fails) / total) * 100).toFixed(1) })
  }
  return days
})()
