import { useState, useMemo, useEffect } from 'react'
import BellCurve from './BellCurve'

const PRESETS = [10, 15, 20, 30, 50]

/* ── Statistics helpers ── */
function mean(values) {
  if (!values.length) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function stdDev(values, mu) {
  // Sample standard deviation (n-1)
  if (values.length < 2) return null
  const variance = values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function cpk(mu, sigma, usl, lsl) {
  if (sigma == null || sigma === 0) return null
  if (usl == null && lsl == null) return null
  const cpkUpper = usl != null ? (usl - mu) / (3 * sigma) : Infinity
  const cpkLower = lsl != null ? (mu - lsl) / (3 * sigma) : Infinity
  return Math.min(cpkUpper, cpkLower)
}

function cpkClass(value) {
  if (value == null || !isFinite(value)) return 'cpk-pill--na'
  if (value >= 1.67) return 'cpk-pill--good'
  if (value >= 1.33) return 'cpk-pill--ok'
  return 'cpk-pill--bad'
}


function fmt(n, digits = 3) {
  if (n == null || !isFinite(n)) return '—'
  return Number(n).toFixed(digits)
}

const ZOOM_STORAGE_KEY = 'qms-analysis-zoom'
const ZOOM_MIN = 0.8
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15

export default function AnalysisView({ history, loading, getSpec }) {
  // selectionMode: 'preset' or 'manual'
  const [selectionMode, setSelectionMode] = useState('preset')
  const [preset, setPreset] = useState(10)
  const [manualIds, setManualIds] = useState(new Set())
  const [selectedModel, setSelectedModel] = useState('') // '' = auto (most common)
  const [zoom, setZoom] = useState(() => {
    const stored = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY))
    return isNaN(stored) ? 1.25 : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, stored))
  })

  useEffect(() => {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom))
  }, [zoom])

  // Filter history: only inspections with measurements
  const usableHistory = useMemo(
    () => history.filter((h) => h.measurements && Object.keys(h.measurements).length > 0),
    [history]
  )

  // List of distinct models present
  const availableModels = useMemo(() => {
    const set = new Set()
    usableHistory.forEach((h) => h.model_name && set.add(h.model_name))
    return Array.from(set)
  }, [usableHistory])

  // Default model = most frequent in history
  useEffect(() => {
    if (selectedModel) return
    if (!availableModels.length) return
    const counts = {}
    usableHistory.forEach((h) => {
      if (h.model_name) counts[h.model_name] = (counts[h.model_name] || 0) + 1
    })
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    if (sorted.length) setSelectedModel(sorted[0][0])
  }, [availableModels, usableHistory, selectedModel])

  // Inspections in the same model
  const modelInspections = useMemo(
    () =>
      selectedModel
        ? usableHistory.filter((h) => h.model_name === selectedModel)
        : usableHistory,
    [usableHistory, selectedModel]
  )

  // Inspections selected for analysis
  const selectedInspections = useMemo(() => {
    if (selectionMode === 'preset') return modelInspections.slice(0, preset)
    return modelInspections.filter((h) => manualIds.has(h.id))
  }, [selectionMode, preset, modelInspections, manualIds])

  // Compute stats per measurement key
  const stats = useMemo(() => {
    if (!selectedInspections.length) return []
    // Collect all measurement keys across selected
    const keysOrdered = []
    const seen = new Set()
    selectedInspections.forEach((insp) => {
      Object.keys(insp.measurements || {}).forEach((k) => {
        if (!seen.has(k)) {
          seen.add(k)
          keysOrdered.push(k)
        }
      })
    })

    return keysOrdered.map((key) => {
      const values = []
      selectedInspections.forEach((insp) => {
        const m = insp.measurements?.[key]
        const v = typeof m === 'object' ? m?.value : m
        const num = typeof v === 'number' ? v : parseFloat(v)
        if (!isNaN(num) && num !== 0) values.push(num)
      })
      const n = values.length
      const mu = mean(values)
      const sigma = stdDev(values, mu)
      const min = n ? Math.min(...values) : null
      const max = n ? Math.max(...values) : null
      const range = n ? max - min : null
      const spec = getSpec(selectedModel, key)
      const usl = spec?.usl ?? null
      const lsl = spec?.lsl ?? null
      const nominal = spec?.nominal ?? null
      const cpkVal = cpk(mu, sigma, usl, lsl)
      const sixSigma = sigma != null ? 6 * sigma : null
      return { key, n, mu, sigma, sixSigma, min, max, range, nominal, usl, lsl, cpk: cpkVal, values }
    })
  }, [selectedInspections, selectedModel, getSpec])

  const toggleManual = (id) => {
    setManualIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <div className="loading">Cargando historial…</div>

  return (
    <div className="demo-analysis">
      {/* Controls */}
      <div className="analysis-controls">
        <div className="analysis-controls__group">
          <span className="analysis-controls__label">Modelo:</span>
          <select
            className="analysis-controls__select"
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value)
              setManualIds(new Set())
            }}
          >
            {availableModels.length === 0 && <option value="">(sin datos)</option>}
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="analysis-controls__group">
          <span className="analysis-controls__label">Selección:</span>
          <div className="analysis-controls__preset">
            <button
              className={`analysis-controls__preset-btn ${selectionMode === 'preset' ? 'analysis-controls__preset-btn--active' : ''}`}
              onClick={() => setSelectionMode('preset')}
            >
              Últimas
            </button>
            <button
              className={`analysis-controls__preset-btn ${selectionMode === 'manual' ? 'analysis-controls__preset-btn--active' : ''}`}
              onClick={() => setSelectionMode('manual')}
            >
              Manual
            </button>
          </div>
        </div>

        {selectionMode === 'preset' && (
          <div className="analysis-controls__group">
            <span className="analysis-controls__label">N:</span>
            <div className="analysis-controls__preset">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`analysis-controls__preset-btn ${preset === p ? 'analysis-controls__preset-btn--active' : ''}`}
                  onClick={() => setPreset(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="analysis-controls__summary">
          <div className="analysis-controls__zoom">
            <span className="analysis-controls__label">Zoom:</span>
            <button
              className="analysis-controls__zoom-btn"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= ZOOM_MIN + 0.001}
              title="Reducir tamaño"
            >−</button>
            <button
              className="analysis-controls__zoom-val"
              onClick={() => setZoom(1.25)}
              title="Restablecer al tamaño por defecto (125%)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="analysis-controls__zoom-btn"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= ZOOM_MAX - 0.001}
              title="Aumentar tamaño"
            >+</button>
          </div>
          <div className="analysis-controls__summary-item">
            <span className="analysis-controls__summary-label">Analizadas</span>
            <span className="analysis-controls__summary-val">{selectedInspections.length}</span>
          </div>
        </div>
      </div>

      <div className="analysis-zoom-area" style={{ zoom }}>

      {/* Two-column: stats table | history selector */}
      <div className="analysis-body">
        <div className="analysis-stats">
          <h3>Estadísticas por medición</h3>
          {selectedInspections.length === 0 ? (
            <div className="analysis-empty">
              {selectionMode === 'manual'
                ? 'Selecciona inspecciones del panel derecho para analizar'
                : 'No hay inspecciones disponibles para este modelo'}
            </div>
          ) : (
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Medición</th>
                  <th>n</th>
                  <th>Media (μ)</th>
                  <th className="analysis-table__th-highlight">σ</th>
                  <th className="analysis-table__th-highlight" title="Amplitud natural del proceso = 6 × σ">6σ</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Rango</th>
                  <th>Nominal</th>
                  <th>LSL / USL</th>
                  <th>CPK</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.key}>
                    <td>{s.key}</td>
                    <td>{s.n}</td>
                    <td>{fmt(s.mu, 4)}</td>
                    <td className="analysis-table__six-sigma">{fmt(s.sigma, 4)}</td>
                    <td className="analysis-table__six-sigma">
                      {s.sixSigma == null ? '—' : s.sixSigma.toFixed(4)}
                    </td>
                    <td>{fmt(s.min)}</td>
                    <td>{fmt(s.max)}</td>
                    <td>{fmt(s.range, 4)}</td>
                    <td className={s.nominal == null ? 'analysis-table__missing' : ''}>
                      {s.nominal == null ? 'sin spec' : fmt(s.nominal)}
                    </td>
                    <td className={s.usl == null && s.lsl == null ? 'analysis-table__missing' : ''}>
                      {s.lsl == null && s.usl == null
                        ? '—'
                        : `${s.lsl ?? '—'} / ${s.usl ?? '—'}`}
                    </td>
                    <td>
                      <span className={`cpk-pill ${cpkClass(s.cpk)}`}>
                        {s.cpk == null || !isFinite(s.cpk) ? 'N/A' : s.cpk.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* History selector */}
        <div className="analysis-selector">
          <div className="analysis-selector__header">
            <h3>{selectionMode === 'manual' ? 'Selecciona fotos' : 'Historial reciente'}</h3>
            <span className="analysis-selector__count">
              {selectionMode === 'manual'
                ? `${manualIds.size} seleccionadas`
                : `${selectedInspections.length} usando`}
            </span>
          </div>
          <div className="analysis-selector__list">
            {modelInspections.length === 0 && (
              <div className="analysis-empty">Sin historial para este modelo</div>
            )}
            {modelInspections.slice(0, 100).map((insp, idx) => {
              const isManual = selectionMode === 'manual'
              const selected = isManual
                ? manualIds.has(insp.id)
                : idx < preset
              const time = new Date(insp.created_at).toLocaleString('es-MX', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                day: '2-digit', month: '2-digit',
              })
              return (
                <button
                  key={insp.id}
                  className={`analysis-selector__item ${selected ? 'analysis-selector__item--selected' : ''} ${!isManual ? 'analysis-selector__item--disabled' : ''}`}
                  onClick={() => isManual && toggleManual(insp.id)}
                  disabled={!isManual}
                >
                  <span className="analysis-selector__check">
                    {selected ? '✓' : ''}
                  </span>
                  <span className={`analysis-selector__dot analysis-selector__dot--${insp.result.toLowerCase()}`} />
                  <span className="analysis-selector__time">{time}</span>
                  {insp.model_name && (
                    <span className="analysis-selector__model">{insp.model_name}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bell curves section */}
      {selectedInspections.length > 0 && stats.length > 0 && (
        <div className="analysis-bells">
          <div className="analysis-bells__header">
            <h3>Distribución (curva de campana)</h3>
            <span className="analysis-bells__hint">
              Las colas rojas marcan el <strong>2.5%</strong> por lado (fuera de ±1.96σ).
              Líneas verticales rojas son <strong>USL/LSL</strong>, marca verde es el <strong>nominal</strong>.
            </span>
          </div>
          <div className="analysis-bells__grid">
            {stats.map((s) => (
              <BellCurve
                key={s.key}
                name={s.key}
                values={s.values}
                mu={s.mu}
                sigma={s.sigma}
                usl={s.usl}
                lsl={s.lsl}
                nominal={s.nominal}
              />
            ))}
          </div>
        </div>
      )}
      </div>{/* /analysis-zoom-area */}
    </div>
  )
}
