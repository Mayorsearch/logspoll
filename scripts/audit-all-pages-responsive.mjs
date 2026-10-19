import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

// Mock Data for Real Populated States
const mockUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Admin Tester',
  email: 'admin@logspoll.com',
  role: 'admin',
}

const mockCategories = [
  { id: 'cat-1', slug: 'facebook', name: 'Facebook Accounts', short_name: 'FB', display_order: 1 },
  { id: 'cat-2', slug: 'instagram', name: 'Instagram Accounts', short_name: 'IG', display_order: 2 },
  { id: 'cat-3', slug: 'twitter', name: 'Twitter / X Accounts', short_name: 'X', display_order: 3 },
  { id: 'cat-4', slug: 'tiktok', name: 'TikTok Accounts', short_name: 'TikTok', display_order: 4 },
  { id: 'cat-5', slug: 'gmail', name: 'Gmail & Google Accounts', short_name: 'Gmail', display_order: 5 },
  { id: 'cat-6', slug: 'vpn', name: 'VPN & Proxies', short_name: 'VPN', display_order: 6 },
]

const mockProducts = [
  {
    id: 'prod-1',
    name: 'Facebook 2FA High Quality Aged PVA Account (Server 1)',
    slug: 'facebook-2fa-high-quality-aged-pva',
    price_minor: 450000,
    currency: 'NGN',
    available_quantity: 48,
    category_id: 'cat-1',
    category_name: 'Facebook Accounts',
    server_number: 1,
    supplier_name: 'Server 1',
    description: 'High quality 2FA enabled aged Facebook account with full recovery access.',
    features: ['2FA Enabled', 'Original Email Included', 'Instant Delivery', 'Replacement Guarantee'],
  },
  {
    id: 'prod-2',
    name: 'Instagram 2018 Aged Personal Account (Server 2)',
    slug: 'instagram-2018-aged-personal',
    price_minor: 350000,
    currency: 'NGN',
    available_quantity: 120,
    category_id: 'cat-2',
    category_name: 'Instagram Accounts',
    server_number: 2,
    supplier_name: 'Server 2',
    description: 'Aged 2018 Instagram account with realistic activity history and email access.',
    features: ['Created in 2018', 'Clean History', 'Instant Delivery'],
  },
  {
    id: 'prod-3',
    name: 'Astrill VPN 1-Year Private Subscription Key (Server 3)',
    slug: 'astrill-vpn-1-year-private-subscription',
    price_minor: 14500000,
    currency: 'NGN',
    available_quantity: 15,
    category_id: 'cat-6',
    category_name: 'VPN & Proxies',
    server_number: 3,
    supplier_name: 'Server 3',
    description: 'Official 1-year private activation key for Astrill VPN. High speed VIP servers.',
    features: ['1 Year Access', 'Multi-Device Support', 'Official Key'],
  },
  {
    id: 'prod-4',
    name: 'Gemini Pro 1-Month Premium Subscription (Server 4)',
    slug: 'gemini-pro-1-month-premium',
    price_minor: 107100,
    currency: 'NGN',
    available_quantity: 200,
    category_id: 'cat-6',
    category_name: 'AI Tools',
    server_number: 4,
    supplier_name: 'Server 4',
    description: 'Official Gemini Pro 1-month subscription key with 70% markup verified.',
    features: ['Full AI Access', 'Official License', 'Instant Delivery'],
  },
]

const mockOrders = [
  {
    id: 'order-1',
    reference: 'LP-ORD-20261018-001',
    customer_id: mockUser.id,
    customer_email: mockUser.email,
    payment_status: 'paid',
    fulfillment_status: 'delivered',
    total_minor: 450000,
    currency: 'NGN',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product_name: 'Facebook 2FA High Quality Aged PVA Account (Server 1)',
        category_name: 'Facebook Accounts',
        quantity: 1,
        unit_price_minor: 450000,
      },
    ],
  },
  {
    id: 'order-2',
    reference: 'LP-ORD-20261018-002',
    customer_id: mockUser.id,
    customer_email: mockUser.email,
    payment_status: 'pending',
    fulfillment_status: 'unfulfilled',
    total_minor: 350000,
    currency: 'NGN',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    items: [
      {
        id: 'item-2',
        product_id: 'prod-2',
        product_name: 'Instagram 2018 Aged Personal Account (Server 2)',
        category_name: 'Instagram Accounts',
        quantity: 1,
        unit_price_minor: 350000,
      },
    ],
  },
]

const mockPurchases = [
  {
    id: 'pur-1',
    order_id: 'order-1',
    order_reference: 'LP-ORD-20261018-001',
    product_id: 'prod-1',
    product_name: 'Facebook 2FA High Quality Aged PVA Account (Server 1)',
    delivery_type: 'Licensed digital credentials',
    instructions: 'Username: fb_user_9921\nPassword: VaultPass_Secure!2026\n2FA Secret: JBSWY3DPEHPK3PXP\nMail: recovery@logspoll.com',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
]

// Static HTTP Server with API mocks
function startServer(port = 4173) {
  const distDir = path.resolve('dist')
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    const pathname = url.pathname

    // Mock API routes for populated UI testing
    if (pathname === '/api/account/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ user: mockUser }))
    }

    if (pathname === '/api/admin/overview') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify({
          records: [
            {
              customers: 412,
              products: 5065,
              orders: 1289,
              paid_orders: 1140,
              revenue_minor: 489500000,
            },
          ],
        })
      )
    }

    if (pathname === '/api/admin/readiness') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify({
          environment: 'production',
          database: 'D1',
          schemaReady: true,
          authReady: true,
          emailConfigured: true,
          catalogConfigured: true,
          livePayments: false,
          automaticFulfillment: false,
          payments: {
            mode: 'sandbox',
            apiKeyConfigured: true,
            webhookSecretConfigured: true,
            ledgerTables: ['bachs_payment_attempts', 'bachs_webhook_events', 'bachs_reservations'],
            webhookHandlerEnabled: true,
            paymentReadPermission: 'payments:read confirmed (HTTP 200)',
            providerCheck: 'Authenticated webhook read succeeded',
            providerHttpStatus: 200,
            webhookDestinationConfigured: true,
            blockers: ['Live checkout remains disabled until explicit production merchant approval is granted.'],
            metrics: {
              total_volume_minor: 489500000,
              total_paid: 1140,
              total_attempts: 1289,
              total_open: 15,
              total_failed: 134,
              total_refunded: 3,
              webhook_count: 1420,
              webhook_processed: 1420,
            },
            history: mockOrders.map((o) => ({
              id: 'att-' + o.id,
              order_id: o.id,
              reference: o.reference,
              customer_id: o.customer_id,
              customer_email: o.customer_email,
              client_request_id: 'req-' + o.id,
              checkout_id: 'chk_' + o.id,
              idempotency_key: 'bachs_key_' + o.id,
              provider_mode: 'sandbox',
              amount_minor: o.total_minor,
              currency: o.currency,
              attempt_status: o.payment_status,
              payment_status: o.payment_status,
              fulfillment_status: o.fulfillment_status,
              created_at: Date.now() - 3600000,
              updated_at: Date.now() - 3500000,
            })),
            webhooks: [
              {
                event_id: 'evt_101',
                event_type: 'checkout.completed',
                checkout_id: 'chk_order-1',
                attempt_id: 'att-order-1',
                processing_status: 'processed',
                received_at: Date.now() - 3600000,
                processed_at: Date.now() - 3599000,
              },
            ],
          },
        })
      )
    }

    if (pathname === '/api/storefront/discovery' || pathname === '/api/products') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify({
          records: mockProducts,
          categories: mockCategories,
          total: mockProducts.length,
        })
      )
    }

    if (pathname === '/api/account/orders' || pathname === '/api/orders') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ records: mockOrders }))
    }

    if (pathname === '/api/account/purchases') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ records: mockPurchases }))
    }

    if (pathname === '/api/categories') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ categories: mockCategories }))
    }

    if (pathname === '/api/admin/supplier-automation') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify({
          global_markup_bps: 5000,
          suppliers: {
            hstora: { name: 'Server 1 · HStora', markup_bps: 5000 },
            youngpg: { name: 'Server 2 · YoungPG', markup_bps: 5000 },
            shopviaclone22: { name: 'Server 3 · ShopViaClone22', markup_bps: 5000 },
            digitalcore: { name: 'Server 4 · DigitalCore', markup_bps: 7000 },
          },
        })
      )
    }

    // Static assets
    let filePath = path.join(distDir, pathname)
    if (filePath.endsWith('/') || !path.extname(filePath)) {
      filePath = path.join(distDir, 'index.html')
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html')
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = mimeTypes[ext] || 'application/octet-stream'

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500)
        res.end('Server Error')
      } else {
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(content)
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server)
    })
  })
}

// CDP Client
class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.callbacks = new Map()
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = (err) => reject(err)
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id)
          this.callbacks.delete(msg.id)
          if (msg.error) cb.reject(new Error(msg.error.message))
          else cb.resolve(msg.result)
        }
      }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws.close()
  }
}

// All pages to audit
const auditPages = [
  // Customer-facing
  { name: 'Homepage', path: '/' },
  { name: 'Marketplace', path: '/marketplace' },
  { name: 'Product Details', path: '/products/facebook-2fa-high-quality-aged-pva' },
  { name: 'Categories', path: '/categories' },
  { name: 'Category Detail', path: '/categories/facebook' },
  { name: 'Pricing', path: '/pricing' },
  { name: 'About Us', path: '/about' },
  { name: 'Customer Support', path: '/support' },
  { name: 'FAQ', path: '/faq' },
  { name: 'Contact', path: '/contact' },
  { name: 'Privacy Policy', path: '/privacy' },
  { name: 'Terms of Service', path: '/terms' },
  { name: 'API Docs', path: '/docs' },
  { name: 'Login', path: '/login' },
  { name: 'Registration', path: '/signup' },
  { name: 'Verify Email', path: '/verify-email' },
  { name: 'Forgot Password', path: '/forgot-password' },
  { name: 'Reset Password', path: '/reset-password' },
  { name: 'Shopping Cart', path: '/cart' },
  { name: 'Checkout', path: '/checkout' },
  { name: 'Customer Dashboard', path: '/dashboard' },
  { name: 'My Orders', path: '/dashboard/orders' },
  { name: 'Digital Delivery Vault', path: '/dashboard/purchases' },
  { name: 'Favorites', path: '/dashboard/favorites' },
  { name: 'Profile', path: '/dashboard/profile' },
  { name: 'Account Settings', path: '/dashboard/settings' },
  { name: 'Dashboard Support', path: '/dashboard/support' },
  { name: 'Transactions', path: '/dashboard/transactions' },
  // Admin pages
  { name: 'Admin Login', path: '/admin/login' },
  { name: 'Admin Overview', path: '/admin/overview' },
  { name: 'Admin Customers', path: '/admin/customers' },
  { name: 'Admin Products', path: '/admin/products' },
  { name: 'Admin Categories', path: '/admin/categories' },
  { name: 'Admin Orders', path: '/admin/orders' },
  { name: 'Admin Purchases', path: '/admin/purchases' },
  { name: 'Admin Reviews', path: '/admin/reviews' },
  { name: 'Admin API Manager', path: '/admin/api-manager' },
  { name: 'Admin Storefront Discovery', path: '/admin/discovery' },
  { name: 'Admin Server 1 HStora', path: '/admin/server1' },
  { name: 'Admin Server 2 YoungPG', path: '/admin/server2' },
  { name: 'Admin Server 3 ShopViaClone22', path: '/admin/server3' },
  { name: 'Admin Server 4 DigitalCore', path: '/admin/server4' },
  { name: 'Admin Supplier Hub', path: '/admin/integrations' },
  { name: 'Admin Support', path: '/admin/support' },
  { name: 'Admin Settings', path: '/admin/settings' },
  { name: 'Admin Audit Log', path: '/admin/audit' },
  { name: 'Admin Email Outbox', path: '/admin/email' },
  { name: 'Admin Payments', path: '/admin/payments' },
]

// All 15 required viewports
const auditViewports = [
  // Mobile
  { width: 320, height: 640, type: 'Mobile', label: '320px' },
  { width: 360, height: 740, type: 'Mobile', label: '360px' },
  { width: 375, height: 667, type: 'Mobile', label: '375px' },
  { width: 390, height: 844, type: 'Mobile', label: '390px' },
  { width: 414, height: 896, type: 'Mobile', label: '414px' },
  { width: 430, height: 932, type: 'Mobile', label: '430px' },
  // Tablet
  { width: 600, height: 960, type: 'Tablet', label: '600px' },
  { width: 768, height: 1024, type: 'Tablet', label: '768px' },
  { width: 820, height: 1180, type: 'Tablet', label: '820px' },
  { width: 1024, height: 768, type: 'Tablet', label: '1024px' },
  // Desktop
  { width: 1280, height: 800, type: 'Desktop', label: '1280px' },
  { width: 1366, height: 768, type: 'Desktop', label: '1366px' },
  { width: 1440, height: 900, type: 'Desktop', label: '1440px' },
  { width: 1920, height: 1080, type: 'Desktop', label: '1920px' },
  { width: 2560, height: 1440, type: 'Desktop', label: '2560px' },
]

async function run() {
  console.log('1. Starting local mock server on port 4173...')
  const server = await startServer(4173)

  console.log('2. Launching headless Chrome...')
  const chromeProcess = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9223',
      '--user-data-dir=/tmp/chrome-full-audit-profile',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,800',
    ],
    { stdio: 'ignore' }
  )

  let versionRes = null
  for (let i = 0; i < 20; i++) {
    try {
      versionRes = await fetch('http://127.0.0.1:9223/json/new', { method: 'PUT' })
      if (versionRes.ok) break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  if (!versionRes) throw new Error('Chrome failed to open debug port 9222')

  try {
    const target = await versionRes.json()
    const wsUrl = target.webSocketDebuggerUrl

    const cdp = new CdpClient(wsUrl)
    await cdp.connect()

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    console.log(`\nStarting responsiveness audit across ${auditPages.length} pages and ${auditViewports.length} viewports...`)

    const pageResults = []
    let totalIssues = 0

    for (const page of auditPages) {
      const pageResult = {
        name: page.name,
        path: page.path,
        mobileStatus: 'PASS',
        tabletStatus: 'PASS',
        desktopStatus: 'PASS',
        issues: [],
      }

      for (const vp of auditViewports) {
        // Set device metrics
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 2,
          mobile: vp.type === 'Mobile',
        })

        // Navigate to the target page
        await cdp.send('Page.navigate', { url: `http://localhost:4173${page.path}` })

        // Give the page time to hydrate & load mock data
        await new Promise((r) => setTimeout(r, 350))

        // Populate cart on checkout / cart pages
        if (page.path === '/cart' || page.path === '/checkout') {
          await cdp.send('Runtime.evaluate', {
            expression: `
              if (!localStorage.getItem('logspoll-cart')) {
                localStorage.setItem('logspoll-cart', JSON.stringify([{ id: 'prod-1', quantity: 1 }]));
              }
            `,
          })
        }

        // Measure layout overflow
        const evalRes = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const doc = document.documentElement;
            const body = document.body;
            const windowW = window.innerWidth;
            const scrollW = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
            const clientW = doc.clientWidth;
            
            // Check body/html overflow concealment constraint
            const htmlStyle = window.getComputedStyle(doc);
            const bodyStyle = body ? window.getComputedStyle(body) : null;
            const hasConcealment = htmlStyle.overflowX === 'hidden' || htmlStyle.overflowX === 'clip' ||
                                   (bodyStyle && (bodyStyle.overflowX === 'hidden' || bodyStyle.overflowX === 'clip'));

            const isInsideScrollContainer = (el) => {
              let p = el.parentElement;
              while (p && p !== body && p !== doc) {
                const s = window.getComputedStyle(p);
                if (['auto', 'scroll'].includes(s.overflowX) && p.scrollWidth > p.clientWidth) {
                  return true;
                }
                p = p.parentElement;
              }
              return false;
            };

            const overflowingElements = [];
            document.querySelectorAll('*').forEach(el => {
              // Ignore scripts, styles, SVGs defs
              if (['SCRIPT', 'STYLE', 'DEFS', 'PATH'].includes(el.tagName)) return;
              if (isInsideScrollContainer(el)) return;
              const rect = el.getBoundingClientRect();
              if (rect.right > windowW + 1) {
                overflowingElements.push({
                  tag: el.tagName,
                  className: String(el.className).slice(0, 50),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  overflowBy: Math.round(rect.right - windowW)
                });
              }
            });

            return {
              windowW,
              scrollW,
              clientW,
              hasConcealment,
              hasOverflow: scrollW > clientW + 1,
              overflowCount: overflowingElements.length,
              overflowingElements: overflowingElements.slice(0, 5)
            };
          })()`,
          returnByValue: true,
        })

        const val = evalRes?.result?.value || {
          windowW: vp.width,
          scrollW: vp.width,
          clientW: vp.width,
          hasConcealment: false,
          hasOverflow: false,
          overflowCount: 0,
          overflowingElements: [],
        }
        const hasIssue = val.hasOverflow || val.overflowCount > 0 || val.hasConcealment

        if (hasIssue) {
          totalIssues++
          const issueDesc = `${vp.label} (${val.scrollW}px > ${val.clientW}px; +${Math.max(0, val.scrollW - val.clientW)}px overflow, ${val.overflowCount} uncontained elements)`
          pageResult.issues.push({
            viewport: vp.label,
            type: vp.type,
            details: issueDesc,
            elements: val.overflowingElements,
            hasConcealment: val.hasConcealment,
          })

          if (vp.type === 'Mobile') pageResult.mobileStatus = 'FAIL'
          if (vp.type === 'Tablet') pageResult.tabletStatus = 'FAIL'
          if (vp.type === 'Desktop') pageResult.desktopStatus = 'FAIL'
        }
      }

      const statusIcon = pageResult.issues.length === 0 ? '✔' : '✘'
      console.log(`[${statusIcon}] ${page.name.padEnd(30)} Mobile: ${pageResult.mobileStatus.padEnd(4)} Tablet: ${pageResult.tabletStatus.padEnd(4)} Desktop: ${pageResult.desktopStatus.padEnd(4)} (Issues: ${pageResult.issues.length})`)
      if (pageResult.issues.length > 0) {
        console.log('   Issues:', pageResult.issues.map((i) => i.details).join('; '))
      }
      pageResults.push(pageResult)
    }

    cdp.close()

    console.log('\n========================================================================')
    console.log(`AUDIT COMPLETE: ${pageResults.length} pages audited. Total issues found: ${totalIssues}`)
    console.log('========================================================================')

    // Write full diagnostic output to a JSON file for analysis
    fs.writeFileSync('scripts/audit-results.json', JSON.stringify(pageResults, null, 2))
    console.log('Saved detailed results to scripts/audit-results.json')
  } finally {
    chromeProcess.kill()
    server.close()
  }
}

run().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})
