import { useRef } from 'react'
export function OtpInput({value,onChange,disabled=false}:{value:string;onChange:(code:string)=>void;disabled?:boolean}){
 const inputs=useRef<(HTMLInputElement|null)[]>([])
 const digits=Array.from({length:6},(_,i)=>value[i]??'')
 function fill(text:string,index:number){
  const clean=text.replace(/\D/g,'').slice(0,6)
  if(clean.length>1){onChange(clean);inputs.current[Math.min(clean.length,5)]?.focus();return}
  digits[index]=clean;onChange(digits.map(d=>d||' ').join(''))
  if(clean&&index<5)inputs.current[index+1]?.focus()
 }
 return <div className="otp-inputs" role="group" aria-label="Six-digit verification code">
  {digits.map((digit,i)=><input key={i} ref={node=>{inputs.current[i]=node}} autoFocus={i===0} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete={i===0?'one-time-code':'off'} aria-label={`Digit ${i+1}`} value={digit.trim()} maxLength={6} disabled={disabled} required onChange={event=>fill(event.target.value,i)} onPaste={event=>{event.preventDefault();fill(event.clipboardData.getData('text'),i)}} onKeyDown={event=>{
   if(event.key==='Backspace'&&!digit.trim()&&i>0){event.preventDefault();digits[i-1]=' ';onChange(digits.join(''));inputs.current[i-1]?.focus()}
   if(event.key==='ArrowLeft'&&i>0)inputs.current[i-1]?.focus()
   if(event.key==='ArrowRight'&&i<5)inputs.current[i+1]?.focus()
  }}/>) }
 </div>
}
