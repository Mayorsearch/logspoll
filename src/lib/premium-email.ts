import type { EmailData, EmailKind } from './email-templates.ts'
import { premiumEmailLayout, premiumEmailLogo } from './premium-email-layout.ts'
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!)
const content={
 verification:['Verify your LogsPoll email','Confirm your email','Enter this code on LogsPoll to finish verifying your account.','EMAIL VERIFICATION'],
 password_reset:['Reset your LogsPoll password','Reset your password','Enter this code on LogsPoll and choose a strong new password.','PASSWORD RECOVERY'],
 welcome:['Welcome to LogsPoll','Your account is ready','Your email is verified. Welcome to your private digital marketplace.','WELCOME TO LOGSPOLL'],
 password_changed:['Your LogsPoll password changed','Your password was changed','Your account password was updated. If this was not you, open LogsPoll directly, reset your password and contact support.','ACCOUNT SECURITY'],
} as const
export function renderPremiumEmail(kind:EmailKind,data:EmailData){
 const [subject,title,message,eyebrow]=content[kind as keyof typeof content]
 const needsCode=kind==='verification'||kind==='password_reset'
 const code=data.verificationCode??(data.preview?'123456':'')
 if(needsCode&&(!/^\d{6}$/.test(code)||data.confirmationUrl))throw new Error('A six-digit verification code is required; authentication links are not supported.')
 const year=data.year??new Date().getUTCFullYear()
 if(!Number.isInteger(year)||year<2026||year>9999)throw new Error('Invalid year.')
 const name=Array.from((data.firstName?.trim()||'there').slice(0,120),char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127?' ':char).join('')
 const security=needsCode?'This code expires in 10 minutes and can be used only once. If you did not request it, ignore this email. LogsPoll will never ask you to share this code.':'Never share passwords or verification codes. Contact LogsPoll support if you do not recognize this activity.'
 const preview=data.preview?'SAMPLE EMAIL — synthetic data; no transaction or account action occurred. ':''
 const codeBlock=needsCode?`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;background:#FFF9F6;border:1px solid #FFDCC7;border-radius:20px"><tr><td align="center" class="codebox" style="padding:30px 12px"><p style="margin:0 0 16px;font-size:14px;color:#68708A">Your ${kind==='password_reset'?'password-reset':'verification'} code</p><div class="code" style="font-size:54px;line-height:68px;letter-spacing:10px;font-weight:800;color:#11152F;font-family:Arial,Helvetica,sans-serif;white-space:nowrap">${code}</div><p style="margin:16px 0 0;font-size:14px;color:#68708A">Expires in <strong>10 minutes</strong></p></td></tr></table>`:''
 const values:Record<string,string>={subject:escape(subject),title:escape(title),message:escape(preview+message),eyebrow:escape(eyebrow.replace('LOGSPOLL','LogsPoll')),first_name:escape(name),code_block:codeBlock,security:escape(security),footer_note:'You received this account notification from LogsPoll.',year:String(year)}
 const html=premiumEmailLayout.replace(/\{\{(\w+)\}\}/g,(_,key:string)=>values[key]??'')
 const text=[preview,`LogsPoll | ${subject}`,`Hi ${name},`,title,message,needsCode?`Your code: ${code}\nExpires in 10 minutes.`:'',security,'Support: https://logspoll.com/support',`© ${year} LogsPoll. https://logspoll.com`].filter(Boolean).join('\n\n')
 return{subject,html,text,attachments:[{filename:'logspoll-logo.png',content:premiumEmailLogo,content_id:'logspoll-premium-logo'}]}
}
