// Pinned Simple Icons assets: https://github.com/simple-icons/simple-icons#cdn-usage.
// Unknown brands use a labelled semantic icon; never borrow another brand's logo.
export type Brand = {label:string;slug?:string;symbol?:string;asset?:string;color:string;kind:'social'|'vpn'|'mail'|'dating'|'service'}
const brands:[RegExp,Brand][]=[
 [/\bastrill\b/i,{label:'Astrill VPN',asset:'/brands/astrill-official-20261014.png',color:'#FF5A0A',kind:'vpn'}],
 [/\bfacebook\b|\bfb\b/i,{label:'Facebook',slug:'facebook',color:'#1877F2',kind:'social'}],
 [/\binstagram\b|\binsta\b/i,{label:'Instagram',slug:'instagram',color:'#D62976',kind:'social'}],
 [/\btik[\s-]?tok\b/i,{label:'TikTok',slug:'tiktok',color:'#101828',kind:'social'}],
 [/\bapple\b|\bi[\s-]?cloud\b|\bitunes\b/i,{label:'Apple',slug:'apple',color:'#101828',kind:'service'}],
 [/\bgoogle\b|\bgmail\b|\bg[\s-]?suite\b/i,{label:'Google',slug:'google',color:'#4285F4',kind:'mail'}],
 [/\byou[\s-]?tube\b/i,{label:'YouTube',slug:'youtube',color:'#E62117',kind:'social'}],
 [/\btelegram\b/i,{label:'Telegram',slug:'telegram',color:'#26A5E4',kind:'social'}],
 [/\bsnapchat\b/i,{label:'Snapchat',slug:'snapchat',color:'#101828',kind:'social'}],
 [/\bspotify\b/i,{label:'Spotify',slug:'spotify',color:'#16883E',kind:'service'}],
 [/\bdiscord\b/i,{label:'Discord',symbol:'discord-icon',color:'#5865F2',kind:'social'}],
 [/\btwitter\b|\bx\s+(?:accounts?|premium)\b|^(?:ypg[-\s])?x$/i,{label:'X / Twitter',symbol:'x-icon',color:'#101828',kind:'social'}],
 [/\bnetflix\b/i,{label:'Netflix',slug:'netflix',color:'#E50914',kind:'service'}],
 [/\blinked[\s-]?in\b/i,{label:'LinkedIn',slug:'linkedin',color:'#0A66C2',kind:'social'}],
 [/\breddit\b/i,{label:'Reddit',slug:'reddit',color:'#FF4500',kind:'social'}],
 [/\bpinterest\b/i,{label:'Pinterest',slug:'pinterest',color:'#BD081C',kind:'social'}],
 [/\btwitch\b/i,{label:'Twitch',slug:'twitch',color:'#6441A5',kind:'social'}],
 [/\bwhats[\s-]?app\b/i,{label:'WhatsApp',slug:'whatsapp',color:'#128C7E',kind:'social'}],
 [/\bbluesky\b/i,{label:'Bluesky',symbol:'bluesky-icon',color:'#1185FE',kind:'social'}],
 [/\btinder\b/i,{label:'Tinder',slug:'tinder',color:'#E54B68',kind:'dating'}],
 [/\bbumble\b/i,{label:'Bumble',color:'#A87800',kind:'dating'}],
 [/\bgrindr\b/i,{label:'Grindr',color:'#A66C00',kind:'dating'}],
 [/\bmeet[\s-]?me\b/i,{label:'MeetMe',color:'#FF5A0A',kind:'dating'}],
 [/\bham\b/i,{label:'Ham',color:'#FF5A0A',kind:'social'}],
 [/\boutlook\b|\bhotmail\b/i,{label:'Outlook',slug:'microsoftoutlook',color:'#0078D4',kind:'mail'}],
 [/\byahoo\b/i,{label:'Yahoo',color:'#6001D2',kind:'mail'}],
 [/\bproton\s?mail\b/i,{label:'Proton Mail',slug:'protonmail',color:'#6D4AFF',kind:'mail'}],
 [/\bgmx\b/i,{label:'GMX',color:'#1C449B',kind:'mail'}],
 [/\bmail\.com\b/i,{label:'Mail.com',color:'#004788',kind:'mail'}],
 [/\bnord\s?vpn\b/i,{label:'NordVPN',slug:'nordvpn',color:'#4687FF',kind:'vpn'}],
 [/\bexpress\s?vpn\b/i,{label:'ExpressVPN',slug:'expressvpn',color:'#DA3940',kind:'vpn'}],
 [/\bproton\s?vpn\b/i,{label:'Proton VPN',slug:'protonvpn',color:'#6D4AFF',kind:'vpn'}],
 [/\bsurfshark\b/i,{label:'Surfshark',color:'#148D91',kind:'vpn'}],
 [/\bwindows\b|\bmicrosoft\b/i,{label:'Microsoft',slug:'microsoft',color:'#0078D4',kind:'service'}],
 [/\bchat\s?gpt\b|\bopenai\b/i,{label:'OpenAI',slug:'openai',color:'#10A37F',kind:'service'}],
 [/\bcap\s?cut\b/i,{label:'CapCut',color:'#101828',kind:'service'}],
 [/\bcash\s?app\b/i,{label:'Cash App',symbol:'cashapp-icon',color:'#00D632',kind:'service'}],
]
const fallback=(text:string):Brand=>/\bvpn\b|\bprox(?:y|ies)\b/i.test(text)?{label:'VPN & privacy',color:'#FF5A0A',kind:'vpn'}:/\be-?mails?\b|\binbox\b/i.test(text)?{label:'Email services',color:'#FF5A0A',kind:'mail'}:/\bdating\b|\bmatchmaking\b/i.test(text)?{label:'Dating services',color:'#FF5A0A',kind:'dating'}:/\bsocial\b/i.test(text)?{label:'Social services',color:'#FF5A0A',kind:'social'}:{label:'Digital services',color:'#FF5A0A',kind:'service'}
const cache=new Map<string,Brand>()
export function detectBrand(title:string,category=''):Brand {
 const key=title+'\0'+category,prior=cache.get(key);if(prior)return prior
 let result:Brand|undefined
 for(const text of [title,category]){
  let position=Infinity
  for(const [pattern,brand] of brands){const match=pattern.exec(text.normalize('NFKC'));if(match&&match.index<position){result=brand;position=match.index}}
  if(result)break
 }
 result??=fallback(title+' '+category)
 if(cache.size>=512)cache.delete(cache.keys().next().value!)
 cache.set(key,result);return result
}
export function brandAsset(brand:Brand):string|null {
 return brand.asset??(brand.slug?`/brands/simple-icons-11.15.0/${brand.slug}.svg`:null)
}
export function artworkLines(title:string,width=34,maxLines=3):string[]{
 const text=Array.from(title.replace(/\s+/g,' ').trim()),lines:string[]=[]
 while(text.length&&lines.length<maxLines){let take=Math.min(width,text.length);if(take<text.length){const space=text.slice(0,take+1).lastIndexOf(' ');if(space>width/2)take=space}lines.push(text.splice(0,take).join('').trim());while(text[0]===' ')text.shift()}
 if(text.length&&lines.length)lines[lines.length-1]=lines[lines.length-1].slice(0,width-1)+'…'
 return lines.length?lines:['Digital service']
}
export function artworkAccent(title:string){let hash=0;for(const char of title)hash=(Math.imul(hash,31)+char.codePointAt(0)!)>>>0;return 24+(hash%88)}
