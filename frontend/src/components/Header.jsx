import ConnectionStatus from './ConnectionStatus'

export default function Header({ bridgeStatus, theme, onToggleTheme }) {
  return (
    <header className="header">
      <img className="header-logo" src={theme === 'dark' ? '/logo-white.png' : '/logo-light.png'} alt="Air Hive" />
      <h1 className="header-title">Quality Management System</h1>
      <div className="header__right">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
        >
          <img
            className="theme-toggle__icon"
            src={theme === 'dark' ? '/sol.png' : '/luna.png'}
            alt={theme === 'dark' ? 'Modo día' : 'Modo noche'}
          />
        </button>
        <ConnectionStatus bridgeStatus={bridgeStatus} />
      </div>
    </header>
  )
}
