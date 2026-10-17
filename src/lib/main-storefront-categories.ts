export const mainStorefrontCategories=[
 {slug:'instagram',name:'Instagram',description:'Published Instagram products'},
 {slug:'facebook',name:'Facebook',description:'Published Facebook products'},
 {slug:'twitter',name:'Twitter (X)',description:'Published Twitter and X products'},
 {slug:'tiktok',name:'TikTok',description:'Published TikTok products'},
 {slug:'gmail',name:'Gmail',description:'Published Gmail products'},
 {slug:'vpn',name:'VPN',description:'Published VPN products'},
] as const
export function resolveMainCategory(value:string){const text=value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(/\b(?:instagram|insta)\b/.test(text))return 'instagram';if(/\b(?:facebook|fb)\b/.test(text))return 'facebook';if(/\btwitter\b/.test(text)||['x','x accounts','x account'].includes(text))return 'twitter';if(/\btik ?tok\b/.test(text))return 'tiktok';if(/\b(?:gmail|google mail)\b/.test(text))return 'gmail';if(/\b(?:vpn|astrill|hma|nordvpn|expressvpn|surfshark|protonvpn|windscribe|cyberghost)\b/.test(text))return 'vpn';return ''}
