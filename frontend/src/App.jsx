import { useState, useEffect, useRef, useCallback } from 'react'
import Header from './components/Header'
import TrafficLight from './components/TrafficLight'
import TriggerButton from './components/TriggerButton'
import BatchTriggerButton from './components/BatchTriggerButton'
import DiagnosticPanel from './components/DiagnosticPanel'
import DemoMode from './components/DemoMode'
import AnalysisView from './components/AnalysisView'
import SpecsEditor from './components/SpecsEditor'
import { useInspections } from './hooks/useInspections'
import { useCommands } from './hooks/useCommands'
import { useBridgeStatus } from './hooks/useBridgeStatus'
import { useTheme } from './hooks/useTheme'
import { useMeasurementSpecs } from './hooks/useMeasurementSpecs'

export default function App() {
  const { latestInspection, history, loading, clearDisplay, fetchGraphics } = useInspections()
  const { trigger, sendCommand, sending } = useCommands()
  const bridgeStatus = useBridgeStatus()
  const { theme, toggleTheme } = useTheme()
  const { getSpec, upsertSpec } = useMeasurementSpecs()
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState('run')
  const [editingSpec, setEditingSpec] = useState(null) // { measurementName, currentValue, unit }
  const [sidebarWidth, setSidebarWidth] = useState(340)
  const [headerHeight, setHeaderHeight] = useState(56)
  // Vertical flex ratio between Mediciones (top) and Historial (bottom). 1 = equal split.
  // Higher = Mediciones grows. Persist in localStorage so user's layout sticks.
  const [measRatio, setMeasRatio] = useState(() => {
    const stored = parseFloat(localStorage.getItem('qms-sidebar-measratio'))
    return isNaN(stored) ? 1 : Math.max(0.15, Math.min(stored, 8))
  })
  // Independent zoom for the Mediciones list contents (lets user fit more in less space)
  const [measZoom, setMeasZoom] = useState(() => {
    const stored = parseFloat(localStorage.getItem('qms-meas-zoom'))
    return isNaN(stored) ? 1 : Math.max(0.6, Math.min(stored, 1.8))
  })
  // Zoom for the top controls (status card + trigger/clear/batch buttons + metadata).
  // Drag the handle below them to shrink/grow proportionally.
  const [controlsZoom, setControlsZoom] = useState(() => {
    const stored = parseFloat(localStorage.getItem('qms-controls-zoom'))
    return isNaN(stored) ? 1 : Math.max(0.5, Math.min(stored, 1.4))
  })
  const [demoScale, setDemoScale] = useState(Math.max(0.7, window.innerWidth / 1920))
  // User-controlled zoom multiplier for demo views (Operadores/Administrador).
  // Applied on top of the auto demoScale. Persisted in localStorage.
  const [demoZoom, setDemoZoom] = useState(() => {
    const stored = parseFloat(localStorage.getItem('qms-demo-zoom'))
    return isNaN(stored) ? 1 : Math.max(0.5, Math.min(stored, 2.5))
  })
  const isDragging = useRef(false)
  const isDraggingHeader = useRef(false)
  const isDraggingMeas = useRef(false)
  const isDraggingControls = useRef(false)
  const measDragStartRef = useRef(null)
  const controlsDragStartRef = useRef(null)
  const mainRef = useRef(null)
  const sidebarRef = useRef(null)

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleHeaderMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingHeader.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleMeasMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingMeas.current = true
    measDragStartRef.current = { y: e.clientY, ratio: measRatio }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [measRatio])

  const handleControlsMouseDown = useCallback((e) => {
    e.preventDefault()
    isDraggingControls.current = true
    controlsDragStartRef.current = { y: e.clientY, zoom: controlsZoom }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [controlsZoom])

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging.current) {
        const newWidth = window.innerWidth - e.clientX
        setSidebarWidth(Math.max(280, Math.min(newWidth, window.innerWidth * 0.6)))
      }
      if (isDraggingHeader.current) {
        const newHeight = e.clientY
        setHeaderHeight(Math.max(42, Math.min(newHeight, 120)))
      }
      if (isDraggingMeas.current && sidebarRef.current && measDragStartRef.current) {
        // Convert vertical drag delta into a flex-ratio change.
        // Use the sidebar's flexible vertical area (~70% of its height) as the scale,
        // and account for the sidebar zoom factor.
        const rect = sidebarRef.current.getBoundingClientRect()
        const zoom = sidebarWidth / 340
        const dy = (e.clientY - measDragStartRef.current.y) / zoom
        const flexArea = rect.height * 0.7
        const change = (dy / flexArea) * 4 // 4 = sensitivity (full sidebar drag ≈ 4 ratio units)
        const next = Math.max(0.15, Math.min(8, measDragStartRef.current.ratio + change))
        setMeasRatio(next)
      }
      if (isDraggingControls.current && controlsDragStartRef.current) {
        // Drag UP shrinks controls (zoom < 1), drag DOWN grows them (zoom > 1).
        // 200px of drag ≈ full range (0.5 to 1.4).
        const zoom = sidebarWidth / 340
        const dy = (e.clientY - controlsDragStartRef.current.y) / zoom
        const change = dy / 220
        const next = Math.max(0.5, Math.min(1.4, controlsDragStartRef.current.zoom + change))
        setControlsZoom(next)
      }
    }
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      if (isDraggingHeader.current) {
        isDraggingHeader.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      if (isDraggingMeas.current) {
        isDraggingMeas.current = false
        measDragStartRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      if (isDraggingControls.current) {
        isDraggingControls.current = false
        controlsDragStartRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    const handleResize = () => setDemoScale(Math.max(0.7, window.innerWidth / 1920))
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('resize', handleResize)
    }
  }, [sidebarWidth])

  // Persist the meas/historial ratio
  useEffect(() => {
    localStorage.setItem('qms-sidebar-measratio', String(measRatio))
  }, [measRatio])

  // Persist the Mediciones inner zoom
  useEffect(() => {
    localStorage.setItem('qms-meas-zoom', String(measZoom))
  }, [measZoom])

  // Persist the top controls zoom
  useEffect(() => {
    localStorage.setItem('qms-controls-zoom', String(controlsZoom))
  }, [controlsZoom])

  // Persist the demo (Operadores/Administrador) zoom
  useEffect(() => {
    localStorage.setItem('qms-demo-zoom', String(demoZoom))
  }, [demoZoom])


  // Auto-clear selection when a new inspection arrives so the user sees the latest
  useEffect(() => {
    if (latestInspection) setSelectedId(null)
  }, [latestInspection?.id])

  const effectiveHistory = history

  // If a history item is selected, show it; otherwise show the latest
  const selectedFromHistory = selectedId ? effectiveHistory.find(h => h.id === selectedId) : null

  // Fetch graphics for history item when selected (lazy-load on demand)
  useEffect(() => {
    if (selectedFromHistory && !selectedFromHistory.graphics_content && selectedFromHistory.graphics_url) {
      fetchGraphics(selectedFromHistory)
    }
  }, [selectedFromHistory?.id, fetchGraphics])
  const inspection = selectedFromHistory || latestInspection
  const isViewingHistory = !!selectedFromHistory
  const currentResult = inspection?.result || null
  const measurements = inspection?.measurements || {}
  const hasMeasurements = Object.keys(measurements).length > 0
  const timestamp = inspection ? new Date(inspection.created_at).toLocaleString('es-MX') : null


  return (
    <div className="app">
      <Header bridgeStatus={bridgeStatus} theme={theme} onToggleTheme={toggleTheme} mode={mode} onModeChange={setMode} height={headerHeight} />
      <div className="header-resize-handle" onMouseDown={handleHeaderMouseDown} />

      {mode === 'analysis' ? (
        <main className="main main--demo" style={{ zoom: demoScale }}>
          <AnalysisView history={history} loading={loading} getSpec={getSpec} />
        </main>
      ) : mode !== 'run' ? (
        <>
          <main className="main main--demo" style={{ zoom: demoScale * demoZoom }}>
            <DemoMode mode={mode} />
          </main>
          <div className="demo-zoom-widget" title="Zoom de la pestaña">
            <button
              className="demo-zoom-widget__btn"
              onClick={() => setDemoZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
              disabled={demoZoom <= 0.51}
              aria-label="Reducir tamaño"
            >−</button>
            <button
              className="demo-zoom-widget__val"
              onClick={() => setDemoZoom(1)}
              title="Restablecer al 100%"
            >{Math.round(demoZoom * 100)}%</button>
            <button
              className="demo-zoom-widget__btn"
              onClick={() => setDemoZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}
              disabled={demoZoom >= 2.49}
              aria-label="Aumentar tamaño"
            >+</button>
          </div>
        </>
      ) : (
      <main className="main" ref={mainRef} style={{ gridTemplateColumns: `1fr auto ${sidebarWidth}px` }}>
        {loading ? (
          <div className="loading">Cargando...</div>
        ) : (
          <>
            {/* Left column — camera image */}
            <div className="main__image-col">
              {inspection && inspection.image_url ? (
                <div className="main__image-container">
                  <img
                    key={`img-${inspection.id}`}
                    src={inspection.image_url}
                    alt={`Inspeccion ${inspection.result}`}
                    className="main__image-img"
                  />
                  {inspection.graphics_content && (
                    <div
                      key={`svg-${inspection.id}`}
                      className="main__image-overlay"
                      dangerouslySetInnerHTML={{ __html: inspection.graphics_content }}
                    />
                  )}
                </div>
              ) : (
                <div className="main__empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <p>Sin inspecciones aun</p>
                  <span>Presiona INSPECCIONAR para iniciar</span>
                </div>
              )}
            </div>

            {/* Resize handle */}
            <div className="resize-handle" onMouseDown={handleMouseDown} />

            {/* Right column — sidebar */}
            <div className="main__sidebar" ref={sidebarRef} style={{ zoom: sidebarWidth / 340 }}>
              {/* Controls + metadata zoom wrapper (drag handle below resizes this whole top area) */}
              <div className="sidebar__top" style={{ zoom: controlsZoom }}>
              {/* Controls */}
              <div className="sidebar__controls">
                <TrafficLight result={currentResult} />
                <div className="sidebar__buttons">
                  <TriggerButton
                    onTrigger={trigger}
                    sending={sending}
                    disabled={!bridgeStatus?.cameraConnected}
                  />
                  <button className="btn-clear" onClick={clearDisplay} title="Limpiar pantalla">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                    LIMPIAR
                  </button>
                </div>
                <BatchTriggerButton
                  onTrigger={trigger}
                  latestInspection={latestInspection}
                  disabled={!bridgeStatus?.cameraConnected}
                />
              </div>

              {/* Metadata */}
              {inspection && (() => {
                // model_name may come combined as "Pieza A / Side 1" — split for display.
                const [piezaName, sideName] = (inspection.model_name || '')
                  .split('/').map((s) => s.trim()).concat(['', ''])
                return (
                <div className="sidebar__section">
                  <div className="sidebar__meta">
                    {piezaName && (
                      <div className="sidebar__meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <path d="M8 21h8M12 17v4" />
                        </svg>
                        <div>
                          <span className="sidebar__meta-label">Pieza</span>
                          <span className="sidebar__meta-value">{piezaName}</span>
                        </div>
                      </div>
                    )}
                    {sideName && (
                      <div className="sidebar__meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12h18" />
                          <path d="M12 3l-3 3M12 3l3 3" />
                          <path d="M12 21l-3-3M12 21l3-3" />
                        </svg>
                        <div>
                          <span className="sidebar__meta-label">Lado</span>
                          <span className="sidebar__meta-value">{sideName}</span>
                        </div>
                      </div>
                    )}
                    {inspection.program_number != null && (
                      <div className="sidebar__meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 12h16M4 18h8" />
                        </svg>
                        <div>
                          <span className="sidebar__meta-label">Programa</span>
                          <span className="sidebar__meta-value">#{inspection.program_number}</span>
                        </div>
                      </div>
                    )}
                    <div className="sidebar__meta-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                      <div>
                        <span className="sidebar__meta-label">Fecha</span>
                        <span className="sidebar__meta-value">{timestamp}</span>
                      </div>
                    </div>
                  </div>
                </div>
                )
              })()}
              </div>{/* /sidebar__top */}

              {/* Horizontal handle to resize the top controls/metadata area */}
              <div
                className="sidebar__v-handle sidebar__v-handle--top"
                onMouseDown={handleControlsMouseDown}
                onDoubleClick={() => setControlsZoom(1)}
                title="Arrastra para compactar/agrandar. Doble click para reset"
              />

              {/* Measurements */}
              {hasMeasurements && (
                <div
                  className="sidebar__section sidebar__section--measurements"
                  style={{ flex: measRatio }}
                >
                  <h4 className="sidebar__section-h">
                    <span>Mediciones</span>
                    <span className="mzoom">
                      <button
                        className="mzoom__btn"
                        onClick={() => setMeasZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))}
                        disabled={measZoom <= 0.61}
                        title="Más pequeño"
                      >−</button>
                      <button
                        className="mzoom__val"
                        onClick={() => setMeasZoom(1)}
                        title="Restablecer (100%)"
                      >{Math.round(measZoom * 100)}%</button>
                      <button
                        className="mzoom__btn"
                        onClick={() => setMeasZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))}
                        disabled={measZoom >= 1.79}
                        title="Más grande"
                      >+</button>
                    </span>
                  </h4>
                  <div className="mlist" style={{ zoom: measZoom }}>
                    {Object.entries(measurements).map(([key, val]) => {
                      const value = typeof val === 'object' ? val.value : val
                      // Angles always render as °, regardless of stored unit (fallback for old data)
                      const isAngle = /[aá]ngulo|angle/i.test(key)
                      const storedUnit = typeof val === 'object' ? val.unit || 'mm' : 'mm'
                      const unit = isAngle ? '°' : storedUnit
                      const isZero = value === 0 || value === '0'
                      const pass = isZero ? false : (typeof val === 'object' ? val.pass : true)
                      const spec = getSpec(inspection?.model_name || 'DEFAULT', key)
                      // Compute tolerance display: "Nominal ±tol" if symmetric, "Nominal +tolUp/-tolDown" if not
                      let specDisplay = null
                      let specTol = null
                      if (spec) {
                        if (spec.nominal != null) {
                          specDisplay = `${spec.nominal}`
                          if (spec.usl != null && spec.lsl != null) {
                            const tolUp = +(spec.usl - spec.nominal).toFixed(4)
                            const tolDown = +(spec.nominal - spec.lsl).toFixed(4)
                            if (Math.abs(tolUp - tolDown) < 1e-6) {
                              specTol = `±${tolUp}`
                            } else {
                              specTol = `+${tolUp} / -${tolDown}`
                            }
                          } else if (spec.usl != null) {
                            specTol = `+${+(spec.usl - spec.nominal).toFixed(4)} / -—`
                          } else if (spec.lsl != null) {
                            specTol = `+— / -${+(spec.nominal - spec.lsl).toFixed(4)}`
                          }
                        } else if (spec.lsl != null || spec.usl != null) {
                          specDisplay = `${spec.lsl ?? '—'} … ${spec.usl ?? '—'}`
                        }
                      }
                      return (
                        <div key={key} className={`mlist__row ${pass ? '' : 'mlist__row--fail'}`}>
                          <span className="mlist__dim">{key}</span>
                          <span className="mlist__val">{isZero ? 'Sin lectura' : `${value} ${unit}`}</span>
                          {specDisplay && (
                            <span className="mlist__spec">
                              <span className="mlist__spec-nominal">{specDisplay}</span>
                              {specTol && (
                                <span className="mlist__spec-tol">{specTol} {unit}</span>
                              )}
                            </span>
                          )}
                          <button
                            className="mlist__spec-edit"
                            title={spec ? 'Editar tolerancias' : 'Agregar tolerancias'}
                            onClick={() => setEditingSpec({ measurementName: key, currentValue: value, unit })}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>
                          <span className="mlist__icon">
                            {pass ? (
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--pass)" strokeWidth="3">
                                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--fail)" strokeWidth="3">
                                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                              </svg>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Vertical resize handle: drag to give more/less space to Mediciones vs Historial */}
              {hasMeasurements && effectiveHistory.length > 0 && (
                <div
                  className="sidebar__v-handle"
                  onMouseDown={handleMeasMouseDown}
                  onDoubleClick={() => setMeasRatio(1)}
                  title="Arrastra para ajustar. Doble click para reset"
                />
              )}

              {/* History */}
              {effectiveHistory.length > 0 && (
                <div
                  className="sidebar__section sidebar__section--history"
                  style={{ flex: 1 }}
                >
                  <h4>
                    Historial
                    {isViewingHistory && (
                      <button className="hchip__back" onClick={() => setSelectedId(null)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 12H5M12 5l-7 7 7 7" />
                        </svg>
                        ACTUAL
                      </button>
                    )}
                  </h4>
                  <div className="hchips">
                    {effectiveHistory.map((item, idx) => {
                      const isActive = selectedId
                        ? item.id === selectedId
                        : idx === 0
                      return (
                        <button
                          key={item.id}
                          className={`hchip hchip--${item.result.toLowerCase()} ${isActive ? 'hchip--active' : ''}`}
                          onClick={() => setSelectedId(idx === 0 && !selectedId ? null : item.id)}
                        >
                          <span className="hchip__badge">{item.result === 'PASS' ? 'ACEPTADA' : 'RECHAZADA'}</span>
                          <span className="hchip__time">
                            {new Date(item.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      )}

      <DiagnosticPanel bridgeStatus={bridgeStatus} onSendCommand={sendCommand} />

      <footer className="footer">
        <span>Prolamsa &copy; {new Date().getFullYear()}</span>
        <span className="footer-version">QMS v1.0</span>
      </footer>

      {editingSpec && (
        <SpecsEditor
          modelName={inspection?.model_name || 'DEFAULT'}
          measurementName={editingSpec.measurementName}
          currentValue={editingSpec.currentValue}
          unit={editingSpec.unit}
          existingSpec={getSpec(inspection?.model_name || 'DEFAULT', editingSpec.measurementName)}
          onClose={() => setEditingSpec(null)}
          onSave={upsertSpec}
        />
      )}
    </div>
  )
}
