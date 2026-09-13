import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function IconBase({
  size = 24,
  children,
  ...props
}: IconProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ListTodoIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </IconBase>
  )
}

export function CalendarIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </IconBase>
  )
}

export function AgentIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 12v2" />
      <path d="M9 12v2" />
    </IconBase>
  )
}

export function ActivityIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </IconBase>
  )
}

export function MoreIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </IconBase>
  )
}
