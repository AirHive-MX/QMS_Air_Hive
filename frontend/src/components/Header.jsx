import ConnectionStatus from './ConnectionStatus'

export default function Header({ bridgeStatus }) {
  return (
    <header className="header">
      <img className="header-logo" src="/logo.png" alt="Air Hive" />
      <h1 className="header-title">Quality Management System</h1>
      <ConnectionStatus bridgeStatus={bridgeStatus} />
    </header>
  )
}
