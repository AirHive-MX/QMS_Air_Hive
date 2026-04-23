import { useState, useEffect } from 'react'
import Header from './components/Header'
import TrafficLight from './components/TrafficLight'
import TriggerButton from './components/TriggerButton'
import DiagnosticPanel from './components/DiagnosticPanel'
import { useInspections } from './hooks/useInspections'
import { useCommands } from './hooks/useCommands'
import { useBridgeStatus } from './hooks/useBridgeStatus'
import { useTheme } from './hooks/useTheme'

export default function App() {
  const { latestInspection, history, loading, clearDisplay, fetchGraphics } = useInspections()
  const { trigger, sendCommand, sending } = useCommands()
  const bridgeStatus = useBridgeStatus()
  const { theme, toggleTheme } = useTheme()
  const [selectedId, setSelectedId] = useState(null)


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
      <Header bridgeStatus={bridgeStatus} theme={theme} onToggleTheme={toggleTheme} />

      <main className="main">
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

            {/* Right column — sidebar */}
            <div className="main__sidebar">
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
              </div>

              {/* Metadata */}
              {inspection && (
                <div className="sidebar__section">
                  <div className="sidebar__meta">
                    {inspection.model_name && (
                      <div className="sidebar__meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <path d="M8 21h8M12 17v4" />
                        </svg>
                        <div>
                          <span className="sidebar__meta-label">Modelo</span>
                          <span className="sidebar__meta-value">{inspection.model_name}</span>
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
              )}

              {/* Measurements */}
              {hasMeasurements && (
                <div className="sidebar__section sidebar__section--measurements">
                  <h4>Mediciones</h4>
                  <div className="mlist">
                    {Object.entries(measurements).map(([key, val]) => {
                      const value = typeof val === 'object' ? val.value : val
                      const unit = typeof val === 'object' ? val.unit || 'mm' : 'mm'
                      const isZero = value === 0 || value === '0'
                      const pass = isZero ? false : (typeof val === 'object' ? val.pass : true)
                      return (
                        <div key={key} className={`mlist__row ${pass ? '' : 'mlist__row--fail'}`}>
                          <span className="mlist__dim">{key}</span>
                          <span className="mlist__val">{isZero ? 'Sin lectura' : `${value} ${unit}`}</span>
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

              {/* History */}
              {effectiveHistory.length > 0 && (
                <div className="sidebar__section sidebar__section--history">
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

      <DiagnosticPanel bridgeStatus={bridgeStatus} onSendCommand={sendCommand} />

      <footer className="footer">
        <span>Air Hive &copy; {new Date().getFullYear()}</span>
        <span className="footer-version">QMS v1.0</span>
      </footer>
    </div>
  )
}
