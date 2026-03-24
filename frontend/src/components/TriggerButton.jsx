export default function TriggerButton({ onTrigger, sending, disabled }) {
  return (
    <button
      className={`trigger-btn ${sending ? 'trigger-btn--sending' : ''}`}
      onClick={onTrigger}
      disabled={sending || disabled}
    >
      <svg className="trigger-btn__icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M8 5V19L19 12L8 5Z" fill="currentColor" />
      </svg>
      <span>{sending ? 'Enviando...' : 'TRIGGER'}</span>
    </button>
  )
}
