import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {artworkLines,brandAsset,detectBrand} from '../src/lib/storefront-branding.ts'
test('brands follow product titles first, then category, without misleading substring matches',()=>{
 for(const [name,label] of [['Facebook aged account','Facebook'],['TikTok service','TikTok'],['Astrill VPN 12 months','Astrill VPN'],['Apple ID / iCloud','Apple'],['Gmail','Google'],['Telegram','Telegram'],['Netflix','Netflix'],['Ham','Ham'],['MeetMe','MeetMe'],['Instagram','Instagram'],['X premium','X / Twitter'],['Spotify','Spotify'],['Discord','Discord']])assert.equal(detectBrand(name).label,label)
 assert.equal(detectBrand('Astrill VPN','Google').label,'Astrill VPN')
 assert.equal(detectBrand('2024 service','Facebook').label,'Facebook')
 assert.equal(detectBrand('Example service').label,'Digital services')
 assert.equal(detectBrand('Charming applewood chair').label,'Digital services')
 assert.equal(detectBrand('Pineapple gift').label,'Digital services')
 assert.equal(brandAsset(detectBrand('Ham')),null)
 assert.equal(brandAsset(detectBrand('MeetMe')),null)
 assert.match(brandAsset(detectBrand('Facebook'))!,/^\/brands\/simple-icons-11\.15\.0\/facebook\.svg$/)
})
test('SVG title layout stays bounded for long Unicode names and preserves title-specific text',()=>{
 const a=artworkLines('Facebook business product 2026'),b=artworkLines('Facebook personal product 2025')
 assert.notDeepEqual(a,b)
 for(const name of ['A'.repeat(2000),'📱'.repeat(100),'<script>alert("test")</script> '+ 'title '.repeat(80),'']){const lines=artworkLines(name);assert.ok(lines.length>0&&lines.length<=3);assert.ok(lines.every(line=>Array.from(line).length<=34))}
 assert.equal(detectBrand('Facebook'),detectBrand('Facebook'))
})
test('every assigned logo is a local verified asset; Astrill uses its official image',()=>{
 const source=readFileSync(new URL('../src/lib/storefront-branding.ts',import.meta.url),'utf8')
 for(const match of source.matchAll(/slug:'([^']+)'/g)){const svg=readFileSync(new URL(`../public/brands/simple-icons-11.15.0/${match[1]}.svg`,import.meta.url),'utf8');assert.ok(svg.startsWith('<svg'));assert.doesNotMatch(svg,/<(?:script|image|foreignObject|use)|\son\w+=|(?:href|src)=/i)}
 const path=brandAsset(detectBrand('Astrill VPN'))!
 assert.ok(path.startsWith('/brands/astrill-official-'))
 assert.deepEqual([...readFileSync(new URL('../public'+path,import.meta.url)).subarray(0,8)],[137,80,78,71,13,10,26,10])
})
