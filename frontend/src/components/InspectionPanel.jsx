export default function InspectionPanel({ inspection, history }) {
  if (!inspection) {
    return (
      <div className="inspection-panel inspection-panel--empty">
        <p>Sin inspecciones. Presiona TRIGGER para iniciar.</p>
      </div>
    )
  }

  const measurements = inspection.measurements || {}
  const timestamp = new Date(inspection.created_at).toLocaleString('es-MX')

  return (
    <div className="inspection-panel">
      <div className="inspection-current">
        <h3>Ultima Inspeccion</h3>
        <div className="inspection-meta">
          {inspection.model_name && (
            <div className="meta-item">
              <span className="meta-label">Modelo</span>
              <span className="meta-value">{inspection.model_name}</span>
            </div>
          )}
          {inspection.program_number != null && (
            <div className="meta-item">
              <span className="meta-label">Programa</span>
              <span className="meta-value">#{inspection.program_number}</span>
            </div>
          )}
          <div className="meta-item">
            <span className="meta-label">Fecha</span>
            <span className="meta-value">{timestamp}</span>
          </div>
        </div>

        {Object.keys(measurements).length > 0 && (
          <div className="measurements">
            <h4>Mediciones</h4>
            <table className="measurements-table">
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
                    <tr key={key} className={pass ? 'row-pass' : 'row-fail'}>
                      <td>{key}</td>
                      <td>{value} {unit}</td>
                      <td className="status-cell">{pass ? '\u2713' : '\u2717'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {history && history.length > 1 && (
        <div className="inspection-history">
          <h4>Historial</h4>
          <div className="history-list">
            {history.slice(1).map((item) => (
              <div key={item.id} className={`history-item history-item--${item.result.toLowerCase()}`}>
                <span className="history-result">{item.result}</span>
                <span className="history-model">{item.model_name || '-'}</span>
                <span className="history-time">
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
