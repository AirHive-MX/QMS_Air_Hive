export default function TrafficLight({ result }) {
  const state = result === 'PASS' ? 'pass' : result === 'FAIL' ? 'fail' : 'idle'

  return (
    <div className={`status-card status-card--${state}`}>
      <div className="status-card__indicator">
        <div className="status-card__dot" />
      </div>
      <div className="status-card__info">
        <span className="status-card__label">
          {state === 'pass' ? 'ACEPTADA' : state === 'fail' ? 'RECHAZADA' : 'IDLE'}
        </span>
        <span className="status-card__sub">
          {state === 'pass' ? 'Pieza aprobada' : state === 'fail' ? 'Pieza rechazada' : 'Esperando inspeccion'}
        </span>
      </div>
    </div>
  )
}
