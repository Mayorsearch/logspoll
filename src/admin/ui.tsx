import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Field, Row } from './types'
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="demo-dialog" onCancel={onClose} aria-labelledby="demo-dialog-title"><div className="demo-dialog-heading"><h2 id="demo-dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}</dialog>
}
export function Inputs({ fields, values }: { fields: Field[]; values: Row }) {
  return <>{fields.map(field => <label key={field.key}>{field.label}{field.options ? <select name={field.key} defaultValue={values[field.key] ?? field.options[0]}>{field.options.map(option => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea name={field.key} defaultValue={values[field.key] ?? ''} required={!field.optional} maxLength={2000} rows={3} /> : <input name={field.key} type={field.type ?? 'text'} defaultValue={values[field.key] ?? ''} required={!field.optional} min={field.type === 'number' ? 0 : undefined} step={field.type === 'number' ? 1 : undefined} maxLength={field.type === 'url' ? 500 : 160} />}</label>)}</>
}
