import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, Navigate, useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareAuth } from '../lib/cloudflare-auth'
import { safeReturnTo } from '../lib/auth-policy'
import { OtpInput } from '../components/OtpInput'
import './Otp.css'
type Mode='login'|'signup'|'forgot'|'reset'|'verify'|'admin'
const titles:Record<Mode,string>={login:'Welcome Back',signup:'Create Account',forgot:'Forgot your password?',reset:'Reset your password',verify:'Verify your email',admin:'Administrator Sign In'}
export function AuthPage({mode}:{mode:Mode}){
 const {session,loading,finishRecovery}=useAuth(),location=useLocation(),navigate=useNavigate(),[params]=useSearchParams()
 const state=location.state as {email?:string;sentAt?:number}|null
 const [email,setEmail]=useState(state?.email??'')
 const [pending,setPending]=useState(mode==='reset')
 const [otp,setOtp]=useState(''),[readyAt,setReadyAt]=useState(state?.sentAt?state.sentAt+60000:0)
 const [seconds,setSeconds]=useState(()=>Math.max(0,Math.ceil((readyAt-Date.now())/1000)))
 const [showPassword,setShowPassword]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[complete,setComplete]=useState(false)
 const codeFlow=pending&&['signup','verify','reset'].includes(mode)
 useEffect(()=>{
  const update=()=>setSeconds(Math.max(0,Math.ceil((readyAt-Date.now())/1000)))
  update();const timer=setInterval(update,1000);return()=>clearInterval(timer)
 },[readyAt])
 function sent(){setReadyAt(Date.now()+60000);setPending(true);setOtp('');setMessage('If this account is eligible, a code has been sent. Check your inbox and Spam folder.')}
 function fail(problem:unknown){const text=problem instanceof Error?problem.message:'Please retry.';setError(/invalid otp/i.test(text)?'Code incorrect, expired or already used. Request a new code.':text)}
 async function requestCode(){
  if(mode==='reset'||mode==='forgot')await cloudflareAuth('email-otp/request-password-reset',{email})
  else await cloudflareAuth('email-otp/send-verification-otp',{email,type:'email-verification'})
 }
 async function resend(){if(busy||seconds>0)return;setBusy(true);setError('');try{await requestCode();sent()}catch(problem){fail(problem)}finally{setBusy(false)}}
 async function submit(event:SubmitEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return
  const values=new FormData(event.currentTarget),password=String(values.get('password')??''),name=String(values.get('full_name')??'').trim()
  setError('');setMessage('')
  if(mode==='signup'&&!codeFlow&&name.length<2){setError('Enter your full name (at least 2 characters).');return}
  if((mode==='reset'||(mode==='signup'&&!codeFlow))&&(password.length<12||password!==values.get('confirm'))){setError('Use at least 12 characters and make sure both passwords match.');return}
  if(codeFlow&&!/^\d{6}$/.test(otp)){setError('Enter all six digits.');return}
  setBusy(true)
  try{
   if(mode==='login'||mode==='admin'){await cloudflareAuth('sign-in/email',{email,password});window.location.assign(mode==='admin'?'/admin':safeReturnTo(params.get('next')))}
   else if(codeFlow){
    if(mode==='reset'){await cloudflareAuth('email-otp/reset-password',{email,otp,password});finishRecovery();setMessage('Password updated. Sign in with your new password.')}
    else{await cloudflareAuth('email-otp/verify-email',{email,otp});setMessage('Email verified. You can now sign in.')}
    setComplete(true);setOtp('')
   }else if(mode==='signup'){await cloudflareAuth('sign-up/email',{email,password,name});sent()}
   else{await requestCode();if(mode==='forgot')navigate('/reset-password',{state:{email,sentAt:Date.now()}});else sent()}
  }catch(problem){fail(problem)}finally{setBusy(false)}
 }
 if(loading)return <p className="container section" role="status">Restoring your session…</p>
 if(session&&['login','signup','admin'].includes(mode))return <Navigate to={mode==='admin'?'/admin':safeReturnTo(params.get('next'))} replace/>
 const passwordFields=['login','admin','reset'].includes(mode)||(mode==='signup'&&!codeFlow)
 return <section className={`auth-shell auth-${mode}`}><div className="auth-card"><div className="auth-card-heading"><span className="auth-shield"><ShieldCheck size={34}/></span><h1>{codeFlow&&mode!=='reset'?'Enter your verification code':titles[mode]}</h1><p className="auth-intro">{codeFlow?'Enter the six-digit code from your email. Codes expire after 10 minutes.':mode==='signup'?'Join LogsPoll to access digital tools and the private marketplace.':mode==='forgot'||mode==='verify'?'We’ll send a secure six-digit code to your email.':'Sign in to access your digital marketplace.'}</p></div><div className="auth-card-body">
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!complete&&<form onSubmit={submit} className="account-form"><fieldset disabled={busy}>
   {mode==='signup'&&!codeFlow&&<label>Full Name<input name="full_name" placeholder="John Doe" autoComplete="name" required minLength={2} maxLength={120}/></label>}
   <label>Email Address<input type="email" name="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={event=>{setEmail(event.target.value.trim().toLowerCase());setOtp('')}} readOnly={codeFlow&&mode!=='reset'} required maxLength={254}/></label>
   {codeFlow&&<><OtpInput value={otp} onChange={setOtp} disabled={busy}/><p className="otp-help">Use the most recent code. Never share it with anyone.</p></>}
   {passwordFields&&<label><span className="password-label">{mode==='reset'?'New Password':'Password'}{mode==='login'&&<Link to="/forgot-password">Forgot?</Link>}</span><input type={showPassword?'text':'password'} name="password" placeholder="••••••••" autoComplete={mode==='signup'||mode==='reset'?'new-password':'current-password'} required minLength={mode==='login'||mode==='admin'?1:12} maxLength={128}/></label>}
   {((mode==='signup'&&!codeFlow)||mode==='reset')&&<label>Confirm Password<input type={showPassword?'text':'password'} name="confirm" placeholder="Confirm your password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>}
   {passwordFields&&<button type="button" className="password-visibility" aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'Hide passwords':'Show passwords'}</button>}
   <button className="button" type="submit">{busy?'Please wait…':codeFlow?(mode==='reset'?'Update password':'Verify email'):mode==='signup'?'Create Account':['forgot','verify'].includes(mode)?'Send verification code':'Sign In Securely'}</button>
  </fieldset></form>}
  {codeFlow&&!complete&&<button type="button" className="otp-resend" onClick={()=>void resend()} disabled={busy||seconds>0||!email}>{seconds>0?`Resend code in ${seconds}s`:'Resend code'}</button>}
  {message&&<p className="form-success" role="status">{message}</p>}
  {complete&&<Link className="button" to="/login">Sign in</Link>}
  <div className="auth-links">{mode==='login'?<><p>Don’t have an account? <Link to="/signup">Sign up</Link></p><Link to="/verify-email">Verify your email</Link></>:<Link to="/login">Sign in</Link>}</div>
 </div></div></section>
}
export function AuthCallback(){return <Navigate to="/verify-email" replace/>}
export function RecoveryRedirect(){const {recovery}=useAuth();const {pathname}=useLocation();return recovery&&pathname!=='/reset-password'?<Navigate to="/reset-password" replace/>:null}
