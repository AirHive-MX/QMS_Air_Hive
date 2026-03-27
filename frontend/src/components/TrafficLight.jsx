export default function TrafficLight({ result }) {
  const state = result === 'PASS' ? 'pass' : result === 'FAIL' ? 'fail' : 'idle'

  return (
    <div className={`semaphore semaphore--${state}`}>
      <div className="semaphore__housing">
        <div className="semaphore__lamp semaphore__lamp--red">
          <div className="semaphore__bulb" />
          <div className="semaphore__reflection" />
        </div>
        <div className="semaphore__lamp semaphore__lamp--green">
          <div className="semaphore__bulb" />
          <div className="semaphore__reflection" />
        </div>
      </div>
      <div className="semaphore__status">
        <span className="semaphore__label">
          {state === 'pass' ? 'PASS' : state === 'fail' ? 'FAIL' : 'IDLE'}
        </span>
        <span className="semaphore__sublabel">
          {state === 'pass' ? 'Pieza aprobada' : state === 'fail' ? 'Pieza rechazada' : 'Esperando inspeccion'}
        </span>
      </div>
    </div>
  )
}
