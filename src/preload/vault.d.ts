export interface VaultFileInfo {
  name: string
  mtimeMs: number
  birthtimeMs: number
  size: number
}

export interface VaultReadResult {
  name: string
  content: string
  mtimeMs: number
}

export interface VaultApi {
  status(): Promise<{ root: string }>
  choose(): Promise<{ root: string } | null>
  reveal(): Promise<{ root: string }>
  list(): Promise<VaultFileInfo[]>
  read(name: string): Promise<VaultReadResult>
  write(name: string, content: string): Promise<{ name: string }>
  rename(oldName: string, newName: string): Promise<{ name: string }>
  remove(name: string): Promise<void>
}
