import ConnectionStatus from './ConnectionStatus'

const MODE_LABELS = {
  run: 'Ejecucion',
  operator: 'Operadores',
  admin: 'Administrador',
}

export default function Header({ bridgeStatus, theme, onToggleTheme, mode, onModeChange, height = 56 }) {
  return (
    <header className="header" style={{ zoom: height / 56 }}>
      <img className="header-logo" src="/logo-prolamsa.png" alt="Prolamsa" />
      <h1 className="header-title">Quality Management System</h1>
      <div className="header__right">
        {/* Mode selector */}
        <div className="mode-selector">
          {Object.entries(MODE_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`mode-selector__btn ${mode === key ? 'mode-selector__btn--active' : ''}`}
              onClick={() => onModeChange(key)}
            >
              {key === 'run' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              )}
              {key === 'operator' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
              )}
              {key === 'admin' && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 20V10M12 20V4M6 20v-6" />
                </svg>
              )}
              {label}
            </button>
          ))}
        </div>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo dia' : 'Cambiar a modo noche'}
        >
          <img
            className="theme-toggle__icon"
            src={theme === 'dark' ? '/sol.png' : '/luna.png'}
            alt={theme === 'dark' ? 'Modo dia' : 'Modo noche'}
          />
        </button>
        <ConnectionStatus bridgeStatus={bridgeStatus} />
      </div>
    </header>
  )
}
