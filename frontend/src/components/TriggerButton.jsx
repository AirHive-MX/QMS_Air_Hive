export default function TriggerButton({ onTrigger, sending, disabled }) {
  return (
    <button
      className={`trigger-btn ${sending ? 'trigger-btn--sending' : ''}`}
      onClick={onTrigger}
      disabled={sending || disabled}
    >
      <div className="trigger-btn__ring">
        <svg className="trigger-btn__icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
          {sending ? (
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="16 8" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
            </circle>
          ) : (
            <path d="M8 5V19L19 12L8 5Z" fill="currentColor" />
          )}
        </svg>
      </div>
      <span className="trigger-btn__label">{sending ? 'INSPECCIONANDO...' : 'INSPECCIONAR'}</span>
    </button>
  )
}
