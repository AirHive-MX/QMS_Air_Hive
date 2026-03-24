export default function TrafficLight({ result }) {
  const state = result === 'PASS' ? 'pass' : result === 'FAIL' ? 'fail' : 'idle'

  return (
    <div className={`traffic-light traffic-light--${state}`}>
      <div className="traffic-light__lamp traffic-light__red">
        <div className="traffic-light__glow" />
      </div>
      <div className="traffic-light__lamp traffic-light__green">
        <div className="traffic-light__glow" />
      </div>
      <span className="traffic-light__label">
        {state === 'pass' ? 'PASS' : state === 'fail' ? 'FAIL' : 'IDLE'}
      </span>
    </div>
  )
}
