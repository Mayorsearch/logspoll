// Preview cutover is fail-closed: unported endpoints cannot fall back to Supabase.
// The unchanged legacy production environment does not enable this flag.
export const onRequest = async ({ request, env, next }: { request: Request; env: { AUTH_ENABLED?: string }; next: () => Promise<Response> }) => {
  const path = new URL(request.url).pathname
  if (env.AUTH_ENABLED === 'true' && !path.startsWith('/api/auth/') && !['/api/account/session', '/api/orders', '/api/admin/overview'].includes(path)) {
    return Response.json({ error: 'This operation awaits verified Cloudflare data migration.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  return next()
}
