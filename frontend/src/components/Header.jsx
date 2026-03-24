import ConnectionStatus from './ConnectionStatus'

export default function Header({ bridgeStatus }) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 8V24L16 30L4 24V8L16 2Z" fill="#00D4AA" opacity="0.2" />
            <path d="M16 2L28 8V24L16 30L4 24V8L16 2Z" stroke="#00D4AA" strokeWidth="2" />
            <path d="M10 16H22M16 10V22" stroke="#00D4AA" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="header-text">
          <h1>Air Hive</h1>
          <span className="header-subtitle">QMS Prolamsa</span>
        </div>
      </div>
      <ConnectionStatus bridgeStatus={bridgeStatus} />
    </header>
  )
}
