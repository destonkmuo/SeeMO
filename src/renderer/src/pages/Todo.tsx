import { useState } from 'react'
import PlannerDialog, { type PlannerDialogTarget } from '../components/PlannerDialog'
import { CalendarIcon, ListTodoIcon, PlusIcon, TaskIcon, TrashIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'
import { formatDayLabel, formatTime, isTodoDone, todayISO, type TodoItem } from '../planner'

function metaLine(todo: TodoItem): string {
  const parts: string[] = []
  if (todo.due) {
    parts.push(formatDayLabel(todo.due))
    if (todo.time) parts.push(formatTime(todo.time))
  }
  if (todo.location.trim()) parts.push(todo.location.trim())
  return parts.join(' · ')
}

function TodoRow({
  todo,
  onEdit
}: {
  todo: TodoItem
  onEdit: (todo: TodoItem) => void
}): React.JSX.Element {
  const toggleTodo = useAppStore((state) => state.toggleTodo)
  const deleteTodo = useAppStore((state) => state.deleteTodo)
  const openDay = useAppStore((state) => state.openDay)
  const meta = metaLine(todo)
  const done = isTodoDone(todo)
  return (
    <div className={`todo-row${done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="todo-check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
        onClick={() => toggleTodo(todo.id)}
      >
        <span className="todo-check__box" />
      </button>
      <button type="button" className="todo-main" onClick={() => onEdit(todo)}>
        <span className="todo-title">
          <span
            className={`todo-kind todo-kind--${todo.kind}`}
            title={todo.kind === 'task' ? 'Task' : 'Todo'}
          >
            {todo.kind === 'task' ? <TaskIcon size={12} /> : <ListTodoIcon size={12} />}
          </span>
          {todo.title.trim() || 'Untitled'}
        </span>
        {meta && <span className="todo-meta">{meta}</span>}
        {todo.notes.trim() && <span className="todo-desc">{todo.notes.trim()}</span>}
      </button>
      {todo.due && (
        <button
          type="button"
          className="icon-btn"
          title={`View ${formatDayLabel(todo.due)} on calendar`}
          aria-label={`View on calendar`}
          onClick={() => openDay(todo.due as string)}
        >
          <CalendarIcon size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        title="Delete todo"
        aria-label={`Delete ${todo.title || 'Untitled'}`}
        onClick={() => deleteTodo(todo.id)}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  )
}

function Todo(): React.JSX.Element {
  const todos = useAppStore((state) => state.todos)
  const plannerReady = useAppStore((state) => state.plannerReady)
  const plannerError = useAppStore((state) => state.plannerError)
  const [dialog, setDialog] = useState<PlannerDialogTarget | null>(null)

  const today = todayISO()
  const open = todos.filter((t) => !isTodoDone(t)).sort((a, b) => b.updatedAt - a.updatedAt)
  const overdue = open.filter((t) => t.due !== null && t.due < today)
  const dueToday = open.filter((t) => t.due === today)
  const upcoming = open.filter((t) => t.due !== null && t.due > today)
  const unscheduled = open.filter((t) => t.due === null)
  const done = todos.filter((t) => isTodoDone(t)).sort((a, b) => b.updatedAt - a.updatedAt)

  const groups: { title: string; items: TodoItem[]; className?: string }[] = [
    { title: 'Overdue', items: overdue, className: 'todo-group--overdue' },
    { title: 'Today', items: dueToday },
    { title: 'Upcoming', items: upcoming },
    { title: 'Unscheduled', items: unscheduled },
    { title: 'Done', items: done }
  ]

  return (
    <main className="todo">
      <div className="todo__inner">
        <header className="todo__header">
          <div>
            <h1 className="todo__title">Tasks &amp; Todos</h1>
            <p className="todo__subtitle">
              {open.length === 0
                ? 'All clear.'
                : `${open.length} open · tasks created on the calendar land here`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setDialog({ mode: 'create', kind: 'todo', date: today })}
          >
            <PlusIcon size={15} />
            New todo
          </button>
        </header>

        {plannerError && (
          <p className="cal__error" role="alert">
            {plannerError}
          </p>
        )}
        {!plannerReady ? (
          <p className="cal__empty">Loading todos…</p>
        ) : (
          groups.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.title} className={`todo-group ${group.className ?? ''}`}>
                  <h2 className="todo-group__title">{group.title}</h2>
                  {group.items.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      onEdit={(item) => setDialog({ mode: 'edit-todo', item })}
                    />
                  ))}
                </section>
              )
          )
        )}

        {dialog && <PlannerDialog target={dialog} onClose={() => setDialog(null)} />}
      </div>
    </main>
  )
}

export default Todo
