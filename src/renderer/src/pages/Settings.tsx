import { useCallback, useEffect, useState } from 'react'
import { type CoreState, useAppStore } from '../store/appStore'
import type { GithubStatus } from '../../../preload/github'

const CORE_OPTIONS: { key: CoreState; label: string; hint: string }[] = [
  { key: 'sleep', label: 'Sleep', hint: 'Dormant' },
  { key: 'summoned', label: 'Summoned', hint: 'Just heard the wake word' },
  { key: 'idle', label: 'Idle', hint: 'Listening' },
  { key: 'working', label: 'Working', hint: 'On an objective' },
  { key: 'speaking', label: 'Speaking', hint: 'Talking back' }
]

function GithubBackup(): React.JSX.Element {
  const autoSync = useAppStore((state) => state.autoSync)
  const setAutoSync = useAppStore((state) => state.setAutoSync)
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [repoName, setRepoName] = useState('seemo-notes')
  const [isPrivate, setIsPrivate] = useState(true)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const refresh = useCallback(() => {
    setConfirmingDisconnect(false)
    return window.api.github
      .status()
      .then(setStatus)
      .catch((error) => {
        console.error('[github] status failed', error)
        setMessage('Could not check GitHub status.')
      })
  }, [])

  useEffect(() => {
    // One-time load of main-process state on mount — the canonical exception
    // to the rule below (syncing with an external system, not derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const runAction = <T,>(action: () => Promise<T>, done: (value: T) => void): void => {
    setBusy(true)
    setMessage(null)
    action().then(
      (value) => {
        done(value)
        setBusy(false)
        void refresh()
      },
      (error: unknown) => {
        console.error('[github] action failed', error)
        setMessage(error instanceof Error ? error.message : 'GitHub command failed.')
        setBusy(false)
        void refresh()
      }
    )
  }

  const create = (): void => {
    const name = repoName.trim()
    if (!name) {
      setMessage('Give the repo a name first.')
      return
    }
    runAction(
      () => window.api.github.createRepo(name, isPrivate),
      (result) => setMessage(`Created and pushed to ${result.repoUrl}`)
    )
  }

  const sync = (): void => {
    runAction(
      () => window.api.github.sync(),
      (result) => setMessage(result.detail)
    )
  }

  const disconnect = (): void => {
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true)
      setMessage('This permanently deletes the GitHub repo. Press Disconnect again to confirm.')
      return
    }
    setConfirmingDisconnect(false)
    runAction(
      () => window.api.github.disconnect(),
      (result) => setMessage(`Deleted ${result.deleted}. Local notes are untouched.`)
    )
  }

  return (
    <section className="settings__section">
      <h2 className="settings__section-title">GitHub backup</h2>
      <div className="vault-card">
        <div className="vault-card__info">
          {!status ? (
            <div className="vault-card__meta">Checking GitHub status…</div>
          ) : !status.ghInstalled ? (
            <>
              <div className="vault-card__path">GitHub CLI not found</div>
              <div className="vault-card__meta">
                Install it from https://cli.github.com, then press Refresh.
              </div>
            </>
          ) : !status.authed ? (
            <>
              <div className="vault-card__path">Not signed in</div>
              <div className="vault-card__meta">
                Run <code>gh auth login</code> in a terminal, then press Refresh.
              </div>
            </>
          ) : status.remoteUrl ? (
            <>
              <div className="vault-card__path">
                {status.repoUrl ? (
                  <a href={status.repoUrl} target="_blank" rel="noreferrer">
                    {status.repoUrl.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  status.remoteUrl
                )}
              </div>
              <div className="vault-card__meta">
                Signed in as {status.user ?? 'you'} · branch {status.branch ?? 'main'} ·{' '}
                {status.clean ? 'everything pushed' : 'unpushed changes'}
              </div>
              <label className="settings__check">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(event) => setAutoSync(event.target.checked)}
                />
                Auto-sync
              </label>
            </>
          ) : (
            <>
              <div className="vault-card__path">Signed in as {status.user ?? 'you'}</div>
              <div className="vault-card__meta">
                Creates a repo, commits every note in the vault, and pushes it.
              </div>
              <div className="settings__form">
                <input
                  className="settings__input"
                  value={repoName}
                  maxLength={100}
                  spellCheck={false}
                  placeholder="Repo name"
                  aria-label="Repo name"
                  onChange={(event) => setRepoName(event.target.value)}
                />
                <label className="settings__check">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(event) => setIsPrivate(event.target.checked)}
                  />
                  Private
                </label>
              </div>
            </>
          )}
          {message && <p className="vault-card__meta">{message}</p>}
        </div>
        <div className="vault-card__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          {status && status.ghInstalled && status.authed && !status.remoteUrl && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={create}>
              {busy ? 'Creating…' : 'Create repo'}
            </button>
          )}
          {status?.remoteUrl && (
            <>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={sync}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={disconnect}
                title="Delete the GitHub repo and unlink this vault"
              >
                {confirmingDisconnect ? 'Confirm delete' : 'Disconnect'}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Settings(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const coreState = useAppStore((state) => state.coreState)
  const backgroundListening = useAppStore((state) => state.backgroundListening)
  const setBackgroundListening = useAppStore((state) => state.setBackgroundListening)
  const ttsEnabled = useAppStore((state) => state.ttsEnabled)
  const setTtsEnabled = useAppStore((state) => state.setTtsEnabled)
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

        <GithubBackup />

        <section className="settings__section">
          <h2 className="settings__section-title">SeeMO core</h2>
          <div className="settings__row">
            {CORE_OPTIONS.map((option) => (
              <span
                key={option.key}
                className={`state-pill${option.key === coreState ? ' is-active' : ''}`}
                title={option.hint}
              >
                {option.label}
              </span>
            ))}
          </div>
          <p className="settings__note">
            Current state: <strong>{coreState}</strong>. Driven automatically by voice activity.
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Background SeeMO</h2>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={backgroundListening}
              onChange={(event) => setBackgroundListening(event.target.checked)}
            />
            Always listening
          </label>
          <p className="settings__note">
            When on, SeeMO answers what you say even away from the SeeMO page, and its replies
            surface in a bubble at the bottom-right. The mic pipeline itself always runs; this only
            controls background responses.
          </p>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(event) => setTtsEnabled(event.target.checked)}
            />
            Spoken replies (Piper · Alba medium)
          </label>
          <p className="settings__note">
            When on, finished replies are read aloud through the voice pipeline. Requires the Piper
            binary and Alba voice from start.sh.
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
