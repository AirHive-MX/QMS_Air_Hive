import { useState, useEffect } from 'react'

export default function SpecsEditor({
  modelName,
  measurementName,
  currentValue,
  unit = 'mm',
  existingSpec,
  onClose,
  onSave,
}) {
  const [nominal, setNominal] = useState('')
  const [usl, setUsl] = useState('')
  const [lsl, setLsl] = useState('')
  const [mode, setMode] = useState('range') // 'range' | 'tolerance'
  const [tolPlus, setTolPlus] = useState('')
  const [tolMinus, setTolMinus] = useState('')

  useEffect(() => {
    if (existingSpec) {
      setNominal(existingSpec.nominal ?? '')
      setUsl(existingSpec.usl ?? '')
      setLsl(existingSpec.lsl ?? '')
      if (existingSpec.nominal != null && existingSpec.usl != null && existingSpec.lsl != null) {
        setTolPlus((existingSpec.usl - existingSpec.nominal).toFixed(3))
        setTolMinus((existingSpec.nominal - existingSpec.lsl).toFixed(3))
      }
    } else if (currentValue != null) {
      setNominal(currentValue)
    }
  }, [existingSpec, currentValue])

  const syncFromTolerance = (nom, plus, minus) => {
    const n = parseFloat(nom)
    const p = parseFloat(plus)
    const m = parseFloat(minus)
    if (!isNaN(n) && !isNaN(p)) setUsl((n + p).toFixed(3))
    if (!isNaN(n) && !isNaN(m)) setLsl((n - m).toFixed(3))
  }

  const handleSave = () => {
    onSave({
      model_name: modelName,
      measurement_name: measurementName,
      nominal: nominal === '' ? null : parseFloat(nominal),
      usl: usl === '' ? null : parseFloat(usl),
      lsl: lsl === '' ? null : parseFloat(lsl),
      unit,
    })
    onClose()
  }

  return (
    <div className="specs-modal__overlay" onClick={onClose}>
      <div className="specs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="specs-modal__header">
          <div>
            <h2>Tolerancias</h2>
            <span className="specs-modal__sub">
              <strong>{measurementName}</strong>
              {modelName && <> &middot; modelo <strong>{modelName}</strong></>}
            </span>
          </div>
          <button className="specs-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="specs-modal__mode">
          <button
            className={`specs-modal__mode-btn ${mode === 'range' ? 'specs-modal__mode-btn--active' : ''}`}
            onClick={() => setMode('range')}
          >
            USL / LSL
          </button>
          <button
            className={`specs-modal__mode-btn ${mode === 'tolerance' ? 'specs-modal__mode-btn--active' : ''}`}
            onClick={() => setMode('tolerance')}
          >
            Nominal &plusmn; Tol.
          </button>
        </div>

        <div className="specs-modal__field">
          <label>Nominal ({unit})</label>
          <input
            type="number"
            step="0.001"
            value={nominal}
            onChange={(e) => {
              setNominal(e.target.value)
              if (mode === 'tolerance') syncFromTolerance(e.target.value, tolPlus, tolMinus)
            }}
            placeholder={currentValue != null ? `actual: ${currentValue}` : '0.000'}
          />
        </div>

        {mode === 'range' ? (
          <>
            <div className="specs-modal__field">
              <label>LSL &mdash; Límite inferior ({unit})</label>
              <input
                type="number"
                step="0.001"
                value={lsl}
                onChange={(e) => setLsl(e.target.value)}
                placeholder="0.000"
              />
            </div>
            <div className="specs-modal__field">
              <label>USL &mdash; Límite superior ({unit})</label>
              <input
                type="number"
                step="0.001"
                value={usl}
                onChange={(e) => setUsl(e.target.value)}
                placeholder="0.000"
              />
            </div>
          </>
        ) : (
          <>
            <div className="specs-modal__field">
              <label>Tolerancia &minus; ({unit})</label>
              <input
                type="number"
                step="0.001"
                value={tolMinus}
                onChange={(e) => {
                  setTolMinus(e.target.value)
                  syncFromTolerance(nominal, tolPlus, e.target.value)
                }}
                placeholder="0.050"
              />
            </div>
            <div className="specs-modal__field">
              <label>Tolerancia + ({unit})</label>
              <input
                type="number"
                step="0.001"
                value={tolPlus}
                onChange={(e) => {
                  setTolPlus(e.target.value)
                  syncFromTolerance(nominal, e.target.value, tolMinus)
                }}
                placeholder="0.050"
              />
            </div>
            <div className="specs-modal__field-readonly">
              <span>LSL: <strong>{lsl || '—'}</strong></span>
              <span>USL: <strong>{usl || '—'}</strong></span>
            </div>
          </>
        )}

        <div className="specs-modal__actions">
          <button className="specs-modal__btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="specs-modal__btn-primary" onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
