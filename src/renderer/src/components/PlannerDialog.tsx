import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import type { CalendarItem, PlannerKind, TodoItem } from '../planner'
import { XIcon } from './icons'

export type DialogKind = PlannerKind | 'todo'

export type PlannerDialogTarget =
  | { mode: 'create'; kind: DialogKind; date: string; startTime?: string | null }
  | { mode: 'edit-item'; item: CalendarItem }
  | { mode: 'edit-todo'; item: TodoItem }

function PlannerDialog({
  target,
  onClose
}: {
  target: PlannerDialogTarget
  onClose: () => void
}): React.JSX.Element {
  const addCalendarItem = useAppStore((state) => state.addCalendarItem)
  const updateCalendarItem = useAppStore((state) => state.updateCalendarItem)
  const deleteCalendarItem = useAppStore((state) => state.deleteCalendarItem)
  const addTodo = useAppStore((state) => state.addTodo)
  const updateTodo = useAppStore((state) => state.updateTodo)
  const deleteTodo = useAppStore((state) => state.deleteTodo)

  const [kind, setKind] = useState<DialogKind>(
    target.mode === 'create' ? target.kind : target.mode === 'edit-item' ? target.item.kind : 'todo'
  )
  const [title, setTitle] = useState(() => (target.mode === 'create' ? '' : target.item.title))
  const [description, setDescription] = useState(() =>
    target.mode === 'create' ? '' : target.item.description
  )
  const [location, setLocation] = useState(() =>
    target.mode === 'create' ? '' : target.item.location
  )
  const [date, setDate] = useState(() => {
    if (target.mode === 'create') return target.date
    if (target.mode === 'edit-item') return target.item.date
    return target.item.date ?? ''
  })
  const [noDate, setNoDate] = useState(
    () => target.mode === 'edit-todo' && target.item.date === null
  )
  const [allDay, setAllDay] = useState(() => {
    if (target.mode === 'edit-item') return target.item.startTime === null
    if (target.mode === 'edit-todo') return target.item.time === null
    return target.startTime == null
  })
  const [start, setStart] = useState(() => {
    if (target.mode === 'create') return target.startTime ?? ''
    if (target.mode === 'edit-item') return target.item.startTime ?? ''
    return target.item.time ?? ''
  })
  const [end, setEnd] = useState(() =>
    target.mode === 'edit-item' ? (target.item.endTime ?? '') : ''
  )
  const [done, setDone] = useState(() => target.mode === 'edit-todo' && target.item.done)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isTodo = kind === 'todo'
  const canSave = title.trim().length > 0 && (isTodo ? noDate || date !== '' : date !== '')

  const save = (): void => {
    if (!canSave) return
    const cleanTitle = title.trim()
    if (isTodo) {
      const draft = {
        title: cleanTitle,
        description: description.trim(),
        location: location.trim(),
        date: noDate || !date ? null : date,
        time: noDate || allDay || !start ? null : start
      }
      if (target.mode === 'edit-todo') {
        updateTodo(target.item.id, { ...draft, done })
      } else {
        addTodo(draft)
      }
    } else {
      const endTime = !allDay && end && start && end > start ? end : null
      const draft = {
        kind,
        title: cleanTitle,
        description: description.trim(),
        location: location.trim(),
        date,
        startTime: allDay || !start ? null : start,
        endTime
      }
      if (target.mode === 'edit-item') {
        updateCalendarItem(target.item.id, draft)
      } else {
        addCalendarItem(draft)
      }
    }
    onClose()
  }

  const remove = (): void => {
    if (target.mode === 'edit-item') deleteCalendarItem(target.item.id)
    else if (target.mode === 'edit-todo') deleteTodo(target.item.id)
    onClose()
  }

  const kindLabel = (value: DialogKind): string =>
    value === 'todo' ? 'Todo' : value === 'activity' ? 'Activity' : 'Event'

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={target.mode === 'create' ? 'New calendar entry' : 'Edit calendar entry'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg__head">
          <h2 className="dlg__title">{target.mode === 'create' ? 'New entry' : 'Edit entry'}</h2>
          <button type="button" className="dlg__x" aria-label="Close" onClick={onClose}>
            <XIcon size={15} />
          </button>
        </div>

        <div className="dlg__seg" role="group" aria-label="Entry kind">
          {(target.mode === 'create'
            ? (['event', 'activity', 'todo'] as const)
            : target.mode === 'edit-item'
              ? (['event', 'activity'] as const)
              : (['todo'] as const)
          ).map((value) => (
            <button
              key={value}
              type="button"
              className={`dlg__seg-btn${kind === value ? ' is-active' : ''}`}
              onClick={() => setKind(value)}
            >
              {kindLabel(value)}
            </button>
          ))}
        </div>

        <label className="dlg__field">
          <span className="dlg__label">Title</span>
          <input
            className="dlg__input"
            value={title}
            autoFocus
            placeholder={isTodo ? 'Todo title' : 'Event title'}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
            }}
          />
        </label>

        <div className="dlg__row">
          <label className="dlg__field">
            <span className="dlg__label">{isTodo ? 'Due date' : 'Date'}</span>
            <input
              type="date"
              className="dlg__input"
              value={isTodo && noDate ? '' : date}
              disabled={isTodo && noDate}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          {isTodo ? (
            <label className="dlg__field">
              <span className="dlg__label">Time</span>
              <input
                type="time"
                className="dlg__input"
                value={start}
                disabled={noDate || !date || allDay}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="dlg__field">
                <span className="dlg__label">Start</span>
                <input
                  type="time"
                  className="dlg__input"
                  value={start}
                  disabled={allDay}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className="dlg__field">
                <span className="dlg__label">End</span>
                <input
                  type="time"
                  className="dlg__input"
                  value={end}
                  disabled={allDay}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="dlg__row dlg__row--checks">
          {isTodo ? (
            <>
              <label className="settings__check">
                <input
                  type="checkbox"
                  checked={noDate}
                  onChange={(event) => setNoDate(event.target.checked)}
                />
                No due date
              </label>
              <label className="settings__check">
                <input
                  type="checkbox"
                  checked={allDay}
                  disabled={noDate || !date}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
                All day
              </label>
              {target.mode === 'edit-todo' && (
                <label className="settings__check">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(event) => setDone(event.target.checked)}
                  />
                  Done
                </label>
              )}
            </>
          ) : (
            <label className="settings__check">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              All day
            </label>
          )}
        </div>

        <label className="dlg__field">
          <span className="dlg__label">Location</span>
          <input
            className="dlg__input"
            value={location}
            placeholder="Where?"
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>

        <label className="dlg__field">
          <span className="dlg__label">Description</span>
          <textarea
            className="dlg__input dlg__textarea"
            value={description}
            rows={3}
            placeholder="Details…"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="dlg__actions">
          {target.mode !== 'create' && (
            <button type="button" className="btn btn--danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="dlg__spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlannerDialog
