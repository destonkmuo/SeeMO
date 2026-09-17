import { useState } from 'react'
import PlannerDialog, { type PlannerDialogTarget } from '../components/PlannerDialog'
import { PlusIcon, TrashIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'
import { formatDayLabel, formatTime, todayISO, type TodoItem } from '../planner'

function metaLine(todo: TodoItem): string {
  const parts: string[] = []
  if (todo.date) {
    parts.push(formatDayLabel(todo.date))
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
  const meta = metaLine(todo)
  return (
    <div className={`todo-row${todo.done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="todo-check"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
        onClick={() => toggleTodo(todo.id)}
      >
        <span className="todo-check__box" />
      </button>
      <button type="button" className="todo-main" onClick={() => onEdit(todo)}>
        <span className="todo-title">{todo.title.trim() || 'Untitled'}</span>
        {meta && <span className="todo-meta">{meta}</span>}
        {todo.description.trim() && <span className="todo-desc">{todo.description.trim()}</span>}
      </button>
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
  const open = todos.filter((t) => !t.done).sort((a, b) => b.updatedAt - a.updatedAt)
  const overdue = open.filter((t) => t.date !== null && t.date < today)
  const dueToday = open.filter((t) => t.date === today)
  const upcoming = open.filter((t) => t.date !== null && t.date > today)
  const unscheduled = open.filter((t) => t.date === null)
  const done = todos.filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt)

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
            <h1 className="todo__title">Todo</h1>
            <p className="todo__subtitle">
              {open.length === 0
                ? 'All clear.'
                : `${open.length} open ${open.length === 1 ? 'task' : 'tasks'}`}
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
