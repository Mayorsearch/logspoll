export type Row = Record<string, string>
export interface Field { key: string; label: string; options?: string[]; type?: 'email' | 'number' | 'url' | 'textarea'; optional?: boolean }
