import { useState } from 'react'
import {
  operators,
  operatorInspections,
  dashboardKPIs,
  paretoData,
  machineData,
  operatorPerformance,
  modelData,
  dailyTrend,
} from '../data/demoData'

/* ── Operator View ── */
function OperatorView() {
  const [selectedOp, setSelectedOp] = useState('op1')
  const [selectedInsp, setSelectedInsp] = useState(null)
  const op = operators.find(o => o.id === selectedOp)
  const inspections = operatorInspections[selectedOp] || []
  const passCount = inspections.filter(i => i.result === 'PASS').length
  const failCount = inspections.length - passCount
  const passRate = inspections.length ? ((passCount / inspections.length) * 100).toFixed(1) : 0
  const detail = selectedInsp ? inspections.find(i => i.id === selectedInsp) : null

  return (
    <div className="demo-operator">
      {/* Operator selector */}
      <div className="demo-op-list">
        <h3 className="demo-section-title">Operadores</h3>
        {operators.map(o => {
          const insp = operatorInspections[o.id]
          const pr = insp.length ? (((insp.filter(i => i.result === 'PASS').length) / insp.length) * 100).toFixed(0) : 0
          return (
            <button
              key={o.id}
              className={`demo-op-card ${selectedOp === o.id ? 'demo-op-card--active' : ''}`}
              onClick={() => { setSelectedOp(o.id); setSelectedInsp(null) }}
            >
              <div className="demo-op-avatar">{o.avatar}</div>
              <div className="demo-op-info">
                <span className="demo-op-name">{o.name}</span>
                <span className="demo-op-shift">{o.shift}</span>
              </div>
              <span className="demo-op-rate" style={{ color: pr >= 90 ? 'var(--pass)' : pr >= 80 ? '#f59e0b' : 'var(--fail)' }}>
                {pr}%
              </span>
            </button>
          )
        })}
      </div>

      {/* Operator detail */}
      <div className="demo-op-detail">
        <div className="demo-op-header">
          <div className="demo-op-avatar demo-op-avatar--lg">{op.avatar}</div>
          <div>
            <h2 className="demo-op-detail-name">{op.name}</h2>
            <span className="demo-op-detail-badge">{op.badge} &middot; {op.shift}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="demo-op-stats">
          <div className="demo-kpi-mini">
            <span className="demo-kpi-mini__val">{inspections.length}</span>
            <span className="demo-kpi-mini__label">Inspecciones</span>
          </div>
          <div className="demo-kpi-mini">
            <span className="demo-kpi-mini__val" style={{ color: 'var(--pass)' }}>{passCount}</span>
            <span className="demo-kpi-mini__label">Aceptadas</span>
          </div>
          <div className="demo-kpi-mini">
            <span className="demo-kpi-mini__val" style={{ color: 'var(--fail)' }}>{failCount}</span>
            <span className="demo-kpi-mini__label">Rechazadas</span>
          </div>
          <div className="demo-kpi-mini">
            <span className="demo-kpi-mini__val" style={{ color: passRate >= 90 ? 'var(--pass)' : passRate >= 80 ? '#f59e0b' : 'var(--fail)' }}>
              {passRate}%
            </span>
            <span className="demo-kpi-mini__label">Tasa de paso</span>
          </div>
        </div>

        {/* Inspection detail overlay */}
        {detail && (
          <div className="demo-insp-detail">
            <div className="demo-insp-detail__header">
              <span className={`demo-insp-badge demo-insp-badge--${detail.result.toLowerCase()}`}>
                {detail.result === 'PASS' ? 'ACEPTADA' : 'RECHAZADA'}
              </span>
              <span className="demo-insp-detail__time">
                {new Date(detail.created_at).toLocaleString('es-MX')}
              </span>
              <button className="demo-insp-detail__close" onClick={() => setSelectedInsp(null)}>✕</button>
            </div>
            <div className="demo-insp-detail__meta">
              <span>Modelo: <strong>{detail.model_name}</strong></span>
              <span>Maquina: <strong>{detail.machine}</strong></span>
              {detail.defect && <span style={{ color: 'var(--fail)' }}>Defecto: <strong>{detail.defect}</strong></span>}
            </div>
            <div className="demo-insp-detail__measurements">
              {Object.entries(detail.measurements).map(([key, m]) => (
                <div key={key} className={`demo-meas-row ${m.pass ? '' : 'demo-meas-row--fail'}`}>
                  <span className="demo-meas-name">{key}</span>
                  <span className="demo-meas-val">
                    {m.value === 0 ? 'Sin lectura' : `${m.value} ${m.unit}`}
                  </span>
                  <span className="demo-meas-icon">{m.pass ? '✓' : '✗'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inspection history list */}
        <h3 className="demo-section-title" style={{ marginTop: 16 }}>Historial de inspecciones</h3>
        <div className="demo-insp-list">
          {inspections.map(insp => (
            <button
              key={insp.id}
              className={`demo-insp-row ${selectedInsp === insp.id ? 'demo-insp-row--active' : ''}`}
              onClick={() => setSelectedInsp(insp.id === selectedInsp ? null : insp.id)}
            >
              <span className={`demo-insp-dot demo-insp-dot--${insp.result.toLowerCase()}`} />
              <span className="demo-insp-time">
                {new Date(insp.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="demo-insp-model">{insp.model_name}</span>
              <span className="demo-insp-machine">{insp.machine}</span>
              <span className={`demo-insp-result demo-insp-result--${insp.result.toLowerCase()}`}>
                {insp.result === 'PASS' ? 'ACEPTADA' : 'RECHAZADA'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Admin Dashboard ── */
function AdminDashboard() {
  const kpi = dashboardKPIs
  const maxBarCount = paretoData.length ? paretoData[0].count : 1

  return (
    <div className="demo-admin">
      {/* KPI cards */}
      <div className="demo-kpis">
        <div className="demo-kpi-card">
          <span className="demo-kpi-card__val">{kpi.totalInspections}</span>
          <span className="demo-kpi-card__label">Total inspecciones</span>
        </div>
        <div className="demo-kpi-card demo-kpi-card--pass">
          <span className="demo-kpi-card__val">{kpi.passRate}%</span>
          <span className="demo-kpi-card__label">Tasa de aceptacion</span>
        </div>
        <div className="demo-kpi-card demo-kpi-card--fail">
          <span className="demo-kpi-card__val">{kpi.failCount}</span>
          <span className="demo-kpi-card__label">Rechazos</span>
        </div>
        <div className="demo-kpi-card">
          <span className="demo-kpi-card__val">{kpi.piecesPerHour}</span>
          <span className="demo-kpi-card__label">Piezas / hora</span>
        </div>
        <div className="demo-kpi-card">
          <span className="demo-kpi-card__val">{kpi.avgCycleTime}</span>
          <span className="demo-kpi-card__label">Tiempo ciclo prom.</span>
        </div>
      </div>

      {/* Charts grid */}
      <div className="demo-charts">
        {/* Pareto chart */}
        <div className="demo-chart-card demo-chart-card--wide">
          <h3 className="demo-chart-title">Pareto de defectos</h3>
          <div className="demo-pareto">
            {paretoData.map((d, i) => (
              <div key={i} className="demo-pareto-row">
                <span className="demo-pareto-name">{d.name}</span>
                <div className="demo-pareto-bar-wrap">
                  <div
                    className="demo-pareto-bar"
                    style={{ width: `${(d.count / maxBarCount) * 100}%` }}
                  />
                  <span className="demo-pareto-count">{d.count}</span>
                </div>
                <span className="demo-pareto-pct">{d.percent}%</span>
                <span className="demo-pareto-cum">{d.cumPercent}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* By machine */}
        <div className="demo-chart-card">
          <h3 className="demo-chart-title">Rechazo por maquina</h3>
          <div className="demo-table">
            <div className="demo-table-head">
              <span>Maquina</span><span>Total</span><span>Rechazos</span><span>Tasa %</span>
            </div>
            {machineData.map(m => (
              <div key={m.machine} className="demo-table-row">
                <span className="demo-table-primary">{m.machine}</span>
                <span>{m.total}</span>
                <span style={{ color: 'var(--fail)' }}>{m.fails}</span>
                <span>
                  <span className="demo-rate-pill" style={{
                    background: m.rate > 20 ? 'var(--fail-bg)' : m.rate > 10 ? 'rgba(245,158,11,0.1)' : 'var(--pass-bg)',
                    color: m.rate > 20 ? 'var(--fail)' : m.rate > 10 ? '#f59e0b' : 'var(--pass)',
                  }}>
                    {m.rate}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* By operator */}
        <div className="demo-chart-card">
          <h3 className="demo-chart-title">Rendimiento por operador</h3>
          <div className="demo-table">
            <div className="demo-table-head">
              <span>Operador</span><span>Total</span><span>Rechazos</span><span>Paso %</span>
            </div>
            {operatorPerformance.map(op => (
              <div key={op.name} className="demo-table-row">
                <span className="demo-table-primary">{op.name}</span>
                <span>{op.total}</span>
                <span style={{ color: 'var(--fail)' }}>{op.fails}</span>
                <span>
                  <span className="demo-rate-pill" style={{
                    background: op.passRate >= 90 ? 'var(--pass-bg)' : op.passRate >= 80 ? 'rgba(245,158,11,0.1)' : 'var(--fail-bg)',
                    color: op.passRate >= 90 ? 'var(--pass)' : op.passRate >= 80 ? '#f59e0b' : 'var(--fail)',
                  }}>
                    {op.passRate}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* By model */}
        <div className="demo-chart-card">
          <h3 className="demo-chart-title">Tasa de paso por modelo</h3>
          <div className="demo-model-bars">
            {modelData.map(m => (
              <div key={m.model} className="demo-model-row">
                <span className="demo-model-name">{m.model}</span>
                <div className="demo-model-bar-wrap">
                  <div className="demo-model-bar" style={{ width: `${m.passRate}%` }}>
                    <span className="demo-model-bar-label">{m.passRate}%</span>
                  </div>
                </div>
                <span className="demo-model-count">{m.total} pzas</span>
              </div>
            ))}
          </div>
        </div>

        {/* Daily trend */}
        <div className="demo-chart-card demo-chart-card--wide">
          <h3 className="demo-chart-title">Tendencia diaria (ultimos 7 dias)</h3>
          <div className="demo-trend">
            {dailyTrend.map((d, i) => {
              const maxTotal = Math.max(...dailyTrend.map(x => x.total))
              return (
                <div key={i} className="demo-trend-col">
                  <div className="demo-trend-bars" style={{ height: 120 }}>
                    <div
                      className="demo-trend-bar demo-trend-bar--pass"
                      style={{ height: `${(d.pass / maxTotal) * 100}%` }}
                      title={`Aceptadas: ${d.pass}`}
                    />
                    <div
                      className="demo-trend-bar demo-trend-bar--fail"
                      style={{ height: `${(d.fails / maxTotal) * 100}%` }}
                      title={`Rechazadas: ${d.fails}`}
                    />
                  </div>
                  <span className="demo-trend-label">{d.label}</span>
                  <span className="demo-trend-rate">{d.rate}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Main DemoMode wrapper ── */
export default function DemoMode({ mode }) {
  if (mode === 'operator') return <OperatorView />
  if (mode === 'admin') return <AdminDashboard />
  return null
}
