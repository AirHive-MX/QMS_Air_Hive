import { useState, useMemo } from 'react'

/**
 * Parse pasted Excel/CSV text into spec rows.
 * Smart column detection:
 *   - Col 1 (first) = measurement name (text)
 *   - First numeric column found = nominal
 *   - Last numeric column found (different from nominal) = tolerance (±)
 *   - Other columns (TRUE/FALSE flags, etc.) are ignored
 */
function parseInput(text) {
  if (!text || !text.trim()) return { rows: [], errors: [] }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const rows = []
  const errors = []

  // Detect separator: tab > semicolon > comma
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','

  lines.forEach((line, idx) => {
    const cells = line.split(sep).map((c) => c.trim())
    if (cells.length < 2) {
      errors.push(`Línea ${idx + 1}: pocas columnas`)
      return
    }
    const name = cells[0]
    if (!name) {
      errors.push(`Línea ${idx + 1}: nombre vacío`)
      return
    }
    // Skip header rows: if first cell isn't numeric AND all OTHER cells aren't numeric, it's a header
    const numericCells = cells.slice(1).map((c) => {
      // Accept both 12.037 and 12,037 — replace last comma with dot only if no dot exists
      const cleaned = c.replace(/,/g, '.')
      const n = parseFloat(cleaned)
      return isNaN(n) ? null : n
    })
    const numericIdxs = []
    numericCells.forEach((n, i) => {
      if (n != null) numericIdxs.push({ col: i + 1, value: n })
    })

    if (numericIdxs.length === 0) {
      // Possibly a header — skip silently if first row
      if (idx === 0) return
      errors.push(`Línea ${idx + 1} (${name}): sin valores numéricos`)
      return
    }

    let nominal, tolerance
    if (numericIdxs.length === 1) {
      // Only nominal, no tolerance
      nominal = numericIdxs[0].value
      tolerance = null
    } else {
      // First numeric = nominal, last numeric = tolerance
      nominal = numericIdxs[0].value
      tolerance = numericIdxs[numericIdxs.length - 1].value
    }

    rows.push({
      lineNum: idx + 1,
      measurement_name: name,
      nominal,
      tolerance,
      usl: tolerance != null ? +(nominal + tolerance).toFixed(4) : null,
      lsl: tolerance != null ? +(nominal - tolerance).toFixed(4) : null,
    })
  })

  return { rows, errors }
}

const EXAMPLE = `Perforación 1\t12.035\t0.05
Perforación 2\t12.037\t0.05
Ancho\t50.107\t0.10
Largo\t535.996\t0.15`

export default function BulkSpecsImport({
  initialModel = '',
  availableModels = [],
  onClose,
  onImport,
}) {
  const [modelName, setModelName] = useState(initialModel)
  const [customModel, setCustomModel] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const { rows, errors } = useMemo(() => parseInput(text), [text])

  const effectiveModel = (useCustom ? customModel : modelName).trim()
  const validRows = rows.filter((r) => r.nominal != null)
  const canImport = effectiveModel && validRows.length > 0 && !importing

  const handleImport = async () => {
    setImporting(true)
    const payload = validRows.map((r) => ({
      model_name: effectiveModel,
      measurement_name: r.measurement_name,
      nominal: r.nominal,
      usl: r.usl,
      lsl: r.lsl,
      unit: 'mm',
    }))
    const res = await onImport(payload)
    setResult(res)
    setImporting(false)
  }

  return (
    <div className="specs-modal__overlay" onClick={onClose}>
      <div className="specs-modal specs-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="specs-modal__header">
          <div>
            <h2>Importar tolerancias en lote</h2>
            <span className="specs-modal__sub">
              Pega filas desde Excel: <strong>nombre</strong> &middot; <strong>nominal</strong> &middot; <strong>±tolerancia</strong>
            </span>
          </div>
          <button className="specs-modal__close" onClick={onClose}>✕</button>
        </div>

        {result ? (
          <div className="bulk-import__result">
            {result.error === 0 ? (
              <>
                <div className="bulk-import__result-icon bulk-import__result-icon--ok">✓</div>
                <h3>Importadas {result.ok} tolerancias</h3>
                <p>Modelo: <strong>{effectiveModel}</strong></p>
              </>
            ) : (
              <>
                <div className="bulk-import__result-icon bulk-import__result-icon--err">✕</div>
                <h3>Error al importar</h3>
                <p>{result.message || 'Falló el guardado'}</p>
              </>
            )}
            <div className="specs-modal__actions">
              <button className="specs-modal__btn-primary" onClick={onClose}>Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            {/* Model selector */}
            <div className="specs-modal__field">
              <label>Modelo</label>
              {!useCustom ? (
                <select
                  className="specs-modal__select"
                  value={modelName}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setUseCustom(true)
                      setCustomModel('')
                    } else {
                      setModelName(e.target.value)
                    }
                  }}
                >
                  <option value="">— Selecciona —</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__new__">+ Modelo nuevo…</option>
                </select>
              ) : (
                <div className="bulk-import__custom-model">
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="Nombre del modelo nuevo"
                    autoFocus
                  />
                  <button
                    className="specs-modal__btn-secondary"
                    onClick={() => { setUseCustom(false); setCustomModel('') }}
                  >Cancelar</button>
                </div>
              )}
            </div>

            {/* Paste area */}
            <div className="specs-modal__field">
              <label>Datos (pegar desde Excel)</label>
              <textarea
                className="bulk-import__textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Pega aquí filas separadas por TAB o coma. Ejemplo:\n\n${EXAMPLE}`}
                rows={8}
              />
              <span className="bulk-import__hint">
                💡 <strong>Tip:</strong> en Excel selecciona las celdas y haz Ctrl+C, luego Ctrl+V aquí.
                Columnas con TRUE/FALSE u otras se ignoran automáticamente. La primera columna es el nombre,
                el primer número es el nominal, el último número es la ±tolerancia.
              </span>
            </div>

            {/* Preview */}
            {(rows.length > 0 || errors.length > 0) && (
              <div className="bulk-import__preview">
                <div className="bulk-import__preview-header">
                  <span>Vista previa</span>
                  <span className="bulk-import__preview-count">
                    {validRows.length} listas para importar
                    {errors.length > 0 && ` · ${errors.length} con error`}
                  </span>
                </div>
                <table className="bulk-import__table">
                  <thead>
                    <tr>
                      <th>Medición</th>
                      <th>Nominal</th>
                      <th>± Tol</th>
                      <th>LSL</th>
                      <th>USL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={r.nominal == null ? 'bulk-import__row--err' : ''}>
                        <td>{r.measurement_name}</td>
                        <td>{r.nominal ?? '—'}</td>
                        <td>{r.tolerance != null ? `±${r.tolerance}` : '— (sin tol)'}</td>
                        <td>{r.lsl ?? '—'}</td>
                        <td>{r.usl ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {errors.length > 0 && (
                  <ul className="bulk-import__errors">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="specs-modal__actions">
              <button className="specs-modal__btn-secondary" onClick={onClose}>Cancelar</button>
              <button
                className="specs-modal__btn-primary"
                onClick={handleImport}
                disabled={!canImport}
              >
                {importing ? 'Importando…' : `Importar ${validRows.length} tolerancias`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
