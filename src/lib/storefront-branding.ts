// Pinned Simple Icons assets: https://github.com/simple-icons/simple-icons#cdn-usage.
// Unknown brands use a labelled semantic icon; never borrow another brand's logo.
export type Brand = {label:string;slug?:string;symbol?:string;asset?:string;color:string;kind:'social'|'vpn'|'mail'|'dating'|'service'}
const brands:[RegExp,Brand][]=[
 [/\bastrill\b/i,{label:'Astrill VPN',asset:'/brands/astrill-official-20261014.png',color:'#FF5A0A',kind:'vpn'}],
 [/\bfacebook\b|\bfb\b/i,{label:'Facebook',slug:'facebook',color:'#1877F2',kind:'social'}],
 [/\b(?:instagram|instgram|insta|ig)\b/i,{label:'Instagram',slug:'instagram',color:'#D62976',kind:'social'}],
 [/\b(?:google\s?)?gemini\b/i,{label:'Google Gemini',slug:'googlegemini',color:'#1BA1E3',kind:'service'}],
 [/\bcash\s?app\b/i,{label:'Cash App',slug:'cashapp',color:'#00D632',kind:'service'}],
 [/\bapple\b|\bi[\s-]?cloud\b|\bitunes\b/i,{label:'Apple',slug:'apple',color:'#101828',kind:'service'}],
 [/\bnotion\s?vpn\b/i,{label:'Notion VPN',slug:'notion',color:'#000000',kind:'vpn'}],
 [/\bnotion\b/i,{label:'Notion',slug:'notion',color:'#000000',kind:'service'}],
 [/\bpia\s?vpn\b|\bprivate\s?internet\s?access\b|\bpia\b/i,{label:'PIA VPN',slug:'privateinternetaccess',color:'#4BB543',kind:'vpn'}],
 [/\bhma\s?vpn\b|\bhide\s?my\s?ass\b|\bhma\b/i,{label:'HMA VPN',slug:'hma',color:'#FFCC00',kind:'vpn'}],
 [/\btik[\s-]?tok\b/i,{label:'TikTok',slug:'tiktok',color:'#101828',kind:'social'}],
 [/\bgoogle\b|\bgmail\b|\bg[\s-]?suite\b/i,{label:'Google',slug:'google',color:'#4285F4',kind:'mail'}],
 [/\byou[\s-]?tube\b/i,{label:'YouTube',slug:'youtube',color:'#E62117',kind:'social'}],
 [/\btelegram\b/i,{label:'Telegram',slug:'telegram',color:'#26A5E4',kind:'social'}],
 [/\bsnapchat\b/i,{label:'Snapchat',slug:'snapchat',color:'#FFFC00',kind:'social'}],
 [/\bspotify\b/i,{label:'Spotify',slug:'spotify',color:'#1DB954',kind:'service'}],
 [/\bdiscord\b/i,{label:'Discord',slug:'discord',color:'#5865F2',kind:'social'}],
 [/\bthreads\b/i,{label:'Threads',slug:'threads',color:'#101828',kind:'social'}],
 [/\btwitter\b|\bx\s+(?:accounts?|premium)\b|^(?:ypg[-\s])?x\b/i,{label:'X / Twitter',slug:'x',color:'#101828',kind:'social'}],
 [/\bnetflix\b/i,{label:'Netflix',slug:'netflix',color:'#E50914',kind:'service'}],
 [/\blinked[\s-]?in\b/i,{label:'LinkedIn',slug:'linkedin',color:'#0A66C2',kind:'social'}],
 [/\breddit\b/i,{label:'Reddit',slug:'reddit',color:'#FF4500',kind:'social'}],
 [/\bpinterest\b/i,{label:'Pinterest',slug:'pinterest',color:'#BD081C',kind:'social'}],
 [/\btwitch\b/i,{label:'Twitch',slug:'twitch',color:'#6441A5',kind:'social'}],
 [/\bwhats[\s-]?app\b/i,{label:'WhatsApp',slug:'whatsapp',color:'#25D366',kind:'social'}],
 [/\bbluesky\b/i,{label:'Bluesky',slug:'bluesky',color:'#1185FE',kind:'social'}],
 [/\bclaude\b|\banthropic\b/i,{label:'Claude AI',slug:'claude',color:'#D97757',kind:'service'}],
 [/\bdeepseek\b/i,{label:'DeepSeek',slug:'deepseek',color:'#1E6BFB',kind:'service'}],
 [/\beleven\s?labs\b/i,{label:'ElevenLabs',slug:'elevenlabs',color:'#101828',kind:'service'}],
 [/\bgamma(?:\s?ai)?\b/i,{label:'Gamma AI',slug:'gamma',color:'#7C3AED',kind:'service'}],
 [/\bgrok(?:\s?ai)?\b/i,{label:'Grok AI',slug:'grok',color:'#101828',kind:'service'}],
 [/\bchat\s?gpt\b|\bopenai\b/i,{label:'OpenAI',slug:'openai',color:'#10A37F',kind:'service'}],
 [/\bmastercard\b/i,{label:'Mastercard',slug:'mastercard',color:'#EB001B',kind:'service'}],
 [/\bvisa\b/i,{label:'Visa',slug:'visa',color:'#1A1F71',kind:'service'}],
 [/\bsteam\b/i,{label:'Steam',slug:'steam',color:'#171A21',kind:'service'}],
 [/\bbinance\b/i,{label:'Binance',slug:'binance',color:'#F0B90B',kind:'service'}],
 [/\bpaypal\b/i,{label:'PayPal',slug:'paypal',color:'#00457C',kind:'service'}],
 [/\bamazon\b/i,{label:'Amazon',slug:'amazon',color:'#FF9900',kind:'service'}],
 [/\bgithub\b/i,{label:'GitHub',slug:'github',color:'#101828',kind:'service'}],
 [/\broblox\b/i,{label:'Roblox',slug:'roblox',color:'#000000',kind:'service'}],
 [/\bplaystation\b/i,{label:'PlayStation',slug:'playstation',color:'#003791',kind:'service'}],
 [/\btrust\s?wallet\b/i,{label:'Trust Wallet',slug:'trustwallet',color:'#0500FF',kind:'service'}],
 [/\buber(?:\s?eats)?\b/i,{label:'Uber Eats',slug:'ubereats',color:'#06C167',kind:'service'}],
 [/\biptv\b/i,{label:'IPTV',slug:'iptv',color:'#FF5A0A',kind:'service'}],
 [/\btinder\b/i,{label:'Tinder',slug:'tinder',color:'#E54B68',kind:'dating'}],
 [/\bbumble\b/i,{label:'Bumble',slug:'bumble',color:'#FFC629',kind:'dating'}],
 [/\bgrindr\b/i,{label:'Grindr',color:'#A66C00',kind:'dating'}],
 [/\bmeet[\s-]?me\b/i,{label:'MeetMe',color:'#FF5A0A',kind:'dating'}],
 [/\bham\b/i,{label:'Ham',color:'#FF5A0A',kind:'social'}],
 [/\boutlook\b|\bhotmail\b/i,{label:'Outlook',slug:'microsoftoutlook',color:'#0078D4',kind:'mail'}],
 [/\byahoo\b/i,{label:'Yahoo',slug:'yahoo',color:'#6001D2',kind:'mail'}],
 [/\bproton\s?mail\b/i,{label:'Proton Mail',slug:'protonmail',color:'#6D4AFF',kind:'mail'}],
 [/\bgmx\b/i,{label:'GMX',color:'#1C449B',kind:'mail'}],
 [/\bmail\.com\b/i,{label:'Mail.com',color:'#004788',kind:'mail'}],
 [/\bat&t\b|\batt\b/i,{label:'AT&T',slug:'att',color:'#00A8E0',kind:'mail'}],
 [/\bnord\s?vpn\b/i,{label:'NordVPN',slug:'nordvpn',color:'#4687FF',kind:'vpn'}],
 [/\bexpress\s?vpn\b/i,{label:'ExpressVPN',slug:'expressvpn',color:'#DA3940',kind:'vpn'}],
 [/\bproton\s?vpn\b/i,{label:'Proton VPN',slug:'protonvpn',color:'#6D4AFF',kind:'vpn'}],
 [/\bsurfshark\b/i,{label:'Surfshark',slug:'surfshark',color:'#148D91',kind:'vpn'}],
 [/\bcyber\s?ghost\b/i,{label:'CyberGhost VPN',slug:'cyberghost',color:'#FFD700',kind:'vpn'}],
 [/\bwindscribe\b/i,{label:'Windscribe VPN',slug:'windscribe',color:'#28A745',kind:'vpn'}],
 [/\bipvanish\b/i,{label:'IPVanish VPN',slug:'ipvanish',color:'#43B02A',kind:'vpn'}],
 [/\bpure\s?vpn\b/i,{label:'PureVPN',slug:'purevpn',color:'#10A37F',kind:'vpn'}],
 [/\bmullvad\b/i,{label:'Mullvad VPN',slug:'mullvad',color:'#FFDF00',kind:'vpn'}],
 [/\b(?:ms\s?)?office(?:\s?(?:365|key|plus))?\b/i,{label:'Microsoft Office',slug:'microsoftoffice',color:'#D83B01',kind:'service'}],
 [/\bwindows(?:\s?(?:vps|rdp|10|11|key))?\b/i,{label:'Windows',slug:'windows',color:'#0078D4',kind:'service'}],
 [/\bmicrosoft\b/i,{label:'Microsoft',slug:'microsoft',color:'#0078D4',kind:'service'}],
 [/\bcap\s?cut\b/i,{label:'CapCut',color:'#101828',kind:'service'}],
 [/\bvps\b|\brdp\b|\bdedicated\s?server\b/i,{label:'VPS / RDP Server',slug:'server',color:'#2563EB',kind:'service'}],
 [/\b(?:mobile\s?)?prox(?:y|ies)\b|\bsocks\s?5\b/i,{label:'Proxy Service',slug:'proxy',color:'#6366F1',kind:'vpn'}],
 [/\b(?:email\s?)?database\b|\bleads?\s?database\b/i,{label:'Email Database',slug:'database',color:'#0D9488',kind:'service'}],
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
