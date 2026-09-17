export interface GithubStatus {
  ghInstalled: boolean
  authed: boolean
  user: string | null
  isRepo: boolean
  remoteUrl: string | null
  repoUrl: string | null
  branch: string | null
  clean: boolean
}

export interface GithubCreateResult {
  repoUrl: string
  remoteUrl: string
}

export interface GithubSyncResult {
  pushed: boolean
  detail: string
}

export interface GithubApi {
  status(): Promise<GithubStatus>
  createRepo(name: string, isPrivate: boolean): Promise<GithubCreateResult>
  sync(message?: string): Promise<GithubSyncResult>
  disconnect(): Promise<{ deleted: string }>
}
