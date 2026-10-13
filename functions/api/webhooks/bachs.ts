const disabled = () => Response.json({ error: 'Payments and retired scheduler endpoints are disabled. Use the Cloudflare D1 API.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
export const onRequest = disabled
export const onRequestPost = disabled
export const onRequestGet = disabled
