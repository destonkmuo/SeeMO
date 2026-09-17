import { type CoreState, useAppStore } from '../store/appStore'

const CORE_OPTIONS: { key: CoreState; label: string; hint: string }[] = [
  { key: 'sleep', label: 'Sleep', hint: 'Dormant' },
  { key: 'idle', label: 'Idle', hint: 'Listening' },
  { key: 'working', label: 'Working', hint: 'On an objective' },
  { key: 'speaking', label: 'Speaking', hint: 'Talking back' }
]

function Settings(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const coreState = useAppStore((state) => state.coreState)
  const setCoreState = useAppStore((state) => state.setCoreState)
  const vaultPath = useAppStore((state) => state.vaultPath)
  const vaultReady = useAppStore((state) => state.vaultReady)
  const vaultError = useAppStore((state) => state.vaultError)
  const refreshVault = useAppStore((state) => state.refreshVault)
  const chooseVault = useAppStore((state) => state.chooseVault)

  const revealVault = (): void => {
    window.api.vault.reveal().catch((error) => {
      console.error('[vault] failed to reveal folder', error)
    })
  }

  return (
    <main className="settings">
      <div className="settings__inner">
        <h1 className="settings__title">Settings</h1>

        <section className="settings__section">
          <h2 className="settings__section-title">Notes vault</h2>
          <div className="vault-card">
            <div className="vault-card__info">
              <div className="vault-card__path" title={vaultPath ?? undefined}>
                {vaultPath ?? 'Locating vault…'}
              </div>
              <div className="vault-card__meta">
                {vaultReady
                  ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} on disk · one .md file each`
                  : (vaultError ?? 'Opening…')}
              </div>
              {vaultError && <p className="vault-card__error">{vaultError}</p>}
            </div>
            <div className="vault-card__actions">
              <button type="button" className="btn btn--ghost" onClick={() => void refreshVault()}>
                Refresh
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void chooseVault()}>
                Change folder
              </button>
              <button type="button" className="btn btn--ghost" onClick={revealVault}>
                Show in folder
              </button>
            </div>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Agent core</h2>
          <div className="settings__row">
            {CORE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="btn btn--ghost"
                disabled={option.key === coreState}
                title={option.hint}
                onClick={() => setCoreState(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="settings__note">
            Current state: <strong>{coreState}</strong>. Voice activity drives this automatically;
            these buttons preview each state.
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">About</h2>
          <p className="settings__note">
            <strong>SeeMO</strong> — your notes, organized and always in motion.
          </p>
        </section>
      </div>
    </main>
  )
}

export default Settings
