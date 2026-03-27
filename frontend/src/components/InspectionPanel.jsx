export default function InspectionPanel({ inspection, history }) {
  if (!inspection) {
    return (
      <div className="panel panel--empty">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 8v4l3 3" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        <p>Sin inspecciones aun</p>
        <span>Presiona INSPECCIONAR para iniciar</span>
      </div>
    )
  }

  const measurements = inspection.measurements || {}
  const timestamp = new Date(inspection.created_at).toLocaleString('es-MX')
  const hasMeasurements = Object.keys(measurements).length > 0

  return (
    <div className="panel">
      <div className="panel__header">
        <h3>Ultima Inspeccion</h3>
        <span className={`panel__badge panel__badge--${inspection.result.toLowerCase()}`}>
          {inspection.result}
        </span>
      </div>

      <div className="panel__meta">
        {inspection.model_name && (
          <div className="panel__meta-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <div>
              <span className="panel__meta-label">Modelo</span>
              <span className="panel__meta-value">{inspection.model_name}</span>
            </div>
          </div>
        )}
        {inspection.program_number != null && (
          <div className="panel__meta-item">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h8" />
            </svg>
            <div>
              <span className="panel__meta-label">Programa</span>
              <span className="panel__meta-value">#{inspection.program_number}</span>
            </div>
          </div>
        )}
        <div className="panel__meta-item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 6v6l4 2" />
          </svg>
          <div>
            <span className="panel__meta-label">Fecha</span>
            <span className="panel__meta-value">{timestamp}</span>
          </div>
        </div>
      </div>

      {hasMeasurements && (
        <div className="panel__measurements">
          <h4>Mediciones</h4>
          <table className="mtable">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Valor</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(measurements).map(([key, val]) => {
                const value = typeof val === 'object' ? val.value : val
                const unit = typeof val === 'object' ? val.unit || 'mm' : 'mm'
                const pass = typeof val === 'object' ? val.pass : true
                return (
                  <tr key={key} className={pass ? 'mtable__row--pass' : 'mtable__row--fail'}>
                    <td className="mtable__dim">{key}</td>
                    <td className="mtable__val">{value} {unit}</td>
                    <td className="mtable__status">
                      {pass ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--pass)" strokeWidth="3">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--fail)" strokeWidth="3">
                          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {history && history.length > 1 && (
        <div className="panel__history">
          <h4>Historial reciente</h4>
          <div className="hlist">
            {history.slice(1).map((item) => (
              <div key={item.id} className={`hlist__item hlist__item--${item.result.toLowerCase()}`}>
                <span className={`hlist__badge hlist__badge--${item.result.toLowerCase()}`}>
                  {item.result}
                </span>
                <span className="hlist__model">{item.model_name || '-'}</span>
                <span className="hlist__time">
                  {new Date(item.created_at).toLocaleTimeString('es-MX')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
