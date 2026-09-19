import { useState } from 'react'
import PlannerDialog, { type PlannerDialogTarget } from '../components/PlannerDialog'
import { CalendarIcon, PlusIcon, TrashIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'
import {
  addDays,
  formatDayLabel,
  formatTime,
  isTaskDone,
  todayISO,
  type TaskItem
} from '../planner'

function metaLine(task: TaskItem): string {
  const parts: string[] = []
  if (task.due) {
    parts.push(formatDayLabel(task.due))
    if (task.time) parts.push(formatTime(task.time))
  }
  if (task.location.trim()) parts.push(task.location.trim())
  return parts.join(' · ')
}

function TaskRow({
  task,
  onEdit
}: {
  task: TaskItem
  onEdit: (task: TaskItem) => void
}): React.JSX.Element {
  const toggleTask = useAppStore((state) => state.toggleTask)
  const deleteTask = useAppStore((state) => state.deleteTask)
  const openDay = useAppStore((state) => state.openDay)
  const meta = metaLine(task)
  const done = isTaskDone(task)
  return (
    <div className={`task-row${done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="task-check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => toggleTask(task.id)}
      >
        <span className="task-check__box" />
      </button>
      <button type="button" className="task-main" onClick={() => onEdit(task)}>
        <span className="task-title">{task.title.trim() || 'Untitled'}</span>
        {meta && <span className="task-meta">{meta}</span>}
        {task.notes.trim() && <span className="task-desc">{task.notes.trim()}</span>}
      </button>
      {task.due && (
        <button
          type="button"
          className="icon-btn"
          title={`View ${formatDayLabel(task.due)} on calendar`}
          aria-label={`View on calendar`}
          onClick={() => openDay(task.due as string)}
        >
          <CalendarIcon size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        title="Delete task"
        aria-label={`Delete ${task.title || 'Untitled'}`}
        onClick={() => deleteTask(task.id)}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  )
}

function dayLabel(due: string, today: string, tomorrow: string): string {
  if (due === today) return 'Today'
  if (due === tomorrow) return 'Tomorrow'
  return formatDayLabel(due)
}

function Tasks(): React.JSX.Element {
  const tasks = useAppStore((state) => state.tasks)
  const plannerReady = useAppStore((state) => state.plannerReady)
  const plannerError = useAppStore((state) => state.plannerError)
  const [dialog, setDialog] = useState<PlannerDialogTarget | null>(null)

  const today = todayISO()
  const tomorrow = addDays(today, 1)

  const open = tasks.filter((t) => !isTaskDone(t))
  const overdue = open.filter((t) => t.due !== null && t.due < today)
  // Chronological timeline: dated tasks first by due date + time.
  const dated = open
    .filter((t) => t.due !== null && t.due >= today)
    .sort((a, b) => ((a.due ?? '') + (a.time ?? '') < (b.due ?? '') + (b.time ?? '') ? -1 : 1))
  const general = open.filter((t) => t.due === null).sort((a, b) => b.updatedAt - a.updatedAt)
  const done = tasks.filter((t) => isTaskDone(t)).sort((a, b) => b.updatedAt - a.updatedAt)

  // Preserve chronological order while grouping dated tasks by day.
  const dayGroups: { due: string; items: TaskItem[] }[] = []
  for (const task of dated) {
    const last = dayGroups[dayGroups.length - 1]
    if (last && last.due === task.due) last.items.push(task)
    else dayGroups.push({ due: task.due as string, items: [task] })
  }

  const edit = (item: TaskItem): void => setDialog({ mode: 'edit-task', item })

  return (
    <main className="task">
      <div className="task__inner">
        <header className="task__header">
          <div>
            <h1 className="task__title">Tasks</h1>
            <p className="task__subtitle">
              {open.length === 0
                ? 'All clear.'
                : `${open.length} open · tasks created on the calendar land here`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setDialog({ mode: 'create', kind: 'task', date: today })}
          >
            <PlusIcon size={15} />
            New task
          </button>
        </header>

        {plannerError && (
          <p className="cal__error" role="alert">
            {plannerError}
          </p>
        )}
        {!plannerReady ? (
          <p className="cal__empty">Loading tasks…</p>
        ) : (
          <>
            {(overdue.length > 0 || dayGroups.length > 0) && (
              <section className="task-timeline" aria-label="Task timeline">
                {overdue.length > 0 && (
                  <div className="task-day task-day--overdue">
                    <h2 className="task-day__title">Overdue</h2>
                    {overdue.map((task) => (
                      <TaskRow key={task.id} task={task} onEdit={edit} />
                    ))}
                  </div>
                )}
                {dayGroups.map((group) => (
                  <div key={group.due} className="task-day">
                    <h2 className="task-day__title">{dayLabel(group.due, today, tomorrow)}</h2>
                    {group.items.map((task) => (
                      <TaskRow key={task.id} task={task} onEdit={edit} />
                    ))}
                  </div>
                ))}
              </section>
            )}

            {general.length > 0 && (
              <section className="task-group task-group--general" aria-label="General tasks">
                <h2 className="task-group__title">General</h2>
                <p className="task-group__hint">No due date — anytime tasks.</p>
                {general.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={edit} />
                ))}
              </section>
            )}

            {done.length > 0 && (
              <section className="task-group" aria-label="Completed tasks">
                <h2 className="task-group__title">Done</h2>
                {done.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={edit} />
                ))}
              </section>
            )}
          </>
        )}

        {dialog && <PlannerDialog target={dialog} onClose={() => setDialog(null)} />}
      </div>
    </main>
  )
}

export default Tasks
