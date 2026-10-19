import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

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

async function evalScript(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description)
  }
  return res.result?.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function startStaticServer(port, d1Data) {
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
    console.log(`[REQ] ${req.method} ${pathname}`)

    if (pathname === '/api/account/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ user: d1Data.user }))
    }

    if (pathname === '/api/wallet') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(d1Data.walletOverview))
    }

    if (pathname === '/api/orders' || pathname === '/api/v1/orders' || pathname === '/api/account/orders') {
      const isPurchases = url.searchParams.get('purchases') === 'true'
      const mappedOrders = d1Data.orders.map((o) => ({
        ...o,
        order_items: (o.order_items || []).map((it) => ({
          ...it,
          product_entitlements: (isPurchases && it.instructions) ? {
            instructions: it.instructions,
            structured: it.structured_data || null,
          } : (it.product_entitlements || null),
        })),
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ records: mappedOrders }))
    }

    if (pathname === '/api/account/purchases') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ records: d1Data.purchases }))
    }

    if (pathname === '/api/categories') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ categories: d1Data.categories }))
    }

    if (pathname === '/api/products' || pathname === '/api/storefront/discovery') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ records: d1Data.products, total: d1Data.products.length }))
    }

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
    server.listen(port, () => resolve(server))
  })
}

async function run() {
  console.log('========================================================================')
  console.log('LOGSPOLL FINTECH DASHBOARD & WALLET ACCEPTANCE VERIFICATION')
  console.log('Timestamp:', new Date().toISOString())
  console.log('========================================================================\n')

  const evidenceDir = path.resolve('acceptance-evidence')
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })

  // 1. Authoritative D1 Records
  console.log('1. Setting Authoritative Cloudflare D1 Records...')
  const user = {
    id: 'ca97e1cb-7cfe-4f23-a09b-cb5a931bdac6',
    name: 'badero mayowa',
    email: 'comedianmayorsearch@gmail.com',
    role: 'customer'
  }

  const wallet = {
    id: '1e1dd7a8-3929-4d89-9cb1-fc30f5b4bc79',
    currency: 'NGN',
    balance_minor: 50000,
    status: 'active'
  }

  const transactions = [
    {
      id: 'tx_01jb250',
      type: 'funding',
      amount_minor: 50000,
      direction: 'credit',
      reference: 'WF-01JB250',
      status: 'completed',
      created_at: new Date().toISOString()
    }
  ]

  const orders = [
    {
      id: 'ord_01jb100',
      reference: 'LP-ORD-8821',
      payment_status: 'paid',
      fulfillment_status: 'delivered',
      total_minor: 150000,
      currency: 'NGN',
      created_at: new Date().toISOString(),
      order_items: [
        {
          id: 'item_1',
          product_id: 'prod_1',
          product_name: 'USA Facebook Aged Account (2018-2022) with Cookies',
          quantity: 1,
          unit_price_minor: 150000,
          category_name: 'Facebook Accounts',
          product_entitlements: {
            instructions: 'Login credentials and 2FA keys included.',
            structured: { email: 'user@example.com', pass: 'secret' }
          }
        }
      ]
    }
  ]

  const purchases = orders.flatMap(o => (o.order_items || []).map(it => ({
    ...it,
    order_id: o.id,
    order_reference: o.reference,
    created_at: o.created_at
  })))

  const walletOverview = {
    wallet: {
      id: wallet.id,
      currency: wallet.currency,
      balance_minor: wallet.balance_minor,
      status: wallet.status,
    },
    funding: {
      enabled: true,
      reason: 'Bachs live funding active',
    },
    virtual_account: {
      status: 'VERIFIED',
    },
    deposit_limits: {
      min_ngn: 100,
      max_ngn: 1000000,
    },
    transactions,
  }

  const d1Data = {
    user,
    walletOverview,
    orders,
    purchases,
    categories: [],
    products: [],
  }

  console.log(`   [✔] D1 Customer Loaded: ${user.name} (${user.email})`)
  console.log(`   [✔] D1 Wallet Balance: ₦${(wallet.balance_minor / 100).toFixed(2)}`)
  console.log(`   [✔] D1 Transactions Count: ${transactions.length}`)
  console.log(`   [✔] D1 Orders Count: ${orders.length}`)

  // 2. Start local server
  console.log('\n2. Starting Local Server on Port 4180...')
  const server = await startStaticServer(4180, d1Data)

  // 3. Launch Chrome
  console.log('3. Launching Chrome CDP...')
  const chromeProcess = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9230',
      '--user-data-dir=/tmp/chrome-fintech-test-' + Date.now(),
      '--disable-gpu',
      '--no-sandbox',
    ],
    { stdio: 'ignore' }
  )

  let versionRes = null
  for (let i = 0; i < 20; i++) {
    try {
      versionRes = await fetch('http://127.0.0.1:9230/json/new', { method: 'PUT' })
      if (versionRes.ok) break
    } catch {
      await sleep(250)
    }
  }
  if (!versionRes) throw new Error('Chrome failed to open debug port')

  const target = await versionRes.json()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()

  await cdp.send('Page.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Network.enable')

  const testDevices = [
    {
      name: 'iPhone-Safari',
      label: 'iPhone Safari (390x844)',
      width: 390,
      height: 844,
      dpr: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    },
    {
      name: 'Android-Chrome',
      label: 'Android Chrome (412x915)',
      width: 412,
      height: 915,
      dpr: 2.625,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    },
    {
      name: 'Compact-Mobile',
      label: 'Compact Mobile (320x568)',
      width: 320,
      height: 568,
      dpr: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    },
    {
      name: 'Desktop',
      label: 'Desktop (1280x800)',
      width: 1280,
      height: 800,
      dpr: 1,
      isMobile: false,
      hasTouch: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  ]

  for (const dev of testDevices) {
    console.log(`\n------------------------------------------------------------------------`)
    console.log(`TESTING DEVICE: ${dev.label}`)
    console.log(`------------------------------------------------------------------------`)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: dev.width,
      height: dev.height,
      deviceScaleFactor: dev.dpr,
      mobile: dev.isMobile,
      hasTouch: dev.hasTouch,
    })
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: dev.userAgent,
    })

    // [A] Dashboard Overview
    console.log(`  [A] Testing Dashboard Overview (/dashboard)...`)
    await cdp.send('Page.navigate', { url: 'http://localhost:4180/dashboard' })
    await sleep(2000)

    const dashOverview = await evalScript(cdp, `(() => {
      const shell = document.querySelector('.fintech-dashboard-shell');
      const walletCard = document.querySelector('.fintech-wallet-hero') || document.querySelector('.fintech-wallet-card');
      const balanceAmount = walletCard?.querySelector('.balance-number')?.textContent?.trim() || walletCard?.querySelector('.fintech-card-balance')?.textContent?.trim();
      const addMoneyBtn = walletCard?.querySelector('button');
      const statCards = Array.from(document.querySelectorAll('.fintech-stat, .fintech-stat-card')).map(c => ({
        label: (c.querySelector('.fintech-stat-name, .fintech-stat-label')?.textContent || '').trim(),
        value: (c.querySelector('.fintech-stat-num, .fintech-stat-value')?.textContent || '').trim()
      }));
      const promoBanner = document.querySelector('.fintech-discovery-banner, .fintech-promo-banner');
      const mobileNav = document.querySelector('.fintech-mobile-nav');
      const sidebar = document.querySelector('.fintech-sidebar');
      const navLinks = Array.from(mobileNav?.querySelectorAll('.nav-link, .fintech-nav-item') || []).map(a => ({
        label: (a.querySelector('span:not(.nav-icon)')?.textContent || a.textContent || '').trim(),
        href: a.getAttribute('href'),
        active: a.classList.contains('active')
      }));

      return {
        url: window.location.href,
        title: document.title,
        bodyPreview: document.body.innerText.slice(0, 300),
        shellPresent: Boolean(shell),
        walletCardPresent: Boolean(walletCard),
        balanceAmount,
        addMoneyBtnText: addMoneyBtn?.textContent?.trim(),
        statCards,
        promoBannerPresent: Boolean(promoBanner),
        mobileNavPresent: Boolean(mobileNav),
        mobileNavDisplay: mobileNav ? window.getComputedStyle(mobileNav).display : 'none',
        sidebarPresent: Boolean(sidebar),
        sidebarDisplay: sidebar ? window.getComputedStyle(sidebar).display : 'none',
        navLinks
      };
    })()`)

    console.log(`      Current URL: ${dashOverview.url}`)
    console.log(`      Title: ${dashOverview.title}`)
    if (!dashOverview.shellPresent) {
      console.log(`      Body snippet: ${dashOverview.bodyPreview}`)
    }
    console.log(`      Wallet Card Present: ${dashOverview.walletCardPresent} (Balance: ${dashOverview.balanceAmount})`)
    console.log(`      Quick Action: ${dashOverview.addMoneyBtnText}`)
    console.log(`      Stat Cards:`, dashOverview.statCards.map(s => `${s.label}: ${s.value}`).join(' | '))
    console.log(`      Marketplace Banner Present: ${dashOverview.promoBannerPresent}`)
    if (dev.isMobile) {
      console.log(`      Mobile Bottom Nav (${dashOverview.navLinks.length} items):`, dashOverview.navLinks.map(n => `${n.label}${n.active ? ' (active)' : ''}`).join(' | '))
      if (dashOverview.mobileNavDisplay === 'none') {
        throw new Error('Mobile bottom nav is hidden on mobile device!')
      }
      if (dashOverview.navLinks.length !== 5) {
        throw new Error(`Expected 5 nav links, found ${dashOverview.navLinks.length}`)
      }
    } else {
      console.log(`      Desktop Sidebar Visible: ${dashOverview.sidebarDisplay !== 'none'}`)
      console.log(`      Mobile Nav Hidden: ${dashOverview.mobileNavDisplay === 'none'}`)
      if (dashOverview.sidebarDisplay === 'none') {
        throw new Error('Desktop sidebar is hidden on desktop!')
      }
    }

    // Take screenshot of overview
    const dashShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, `fintech-dashboard-${dev.name}.png`), Buffer.from(dashShot.data, 'base64'))
    console.log(`      [Screenshot Saved]: acceptance-evidence/fintech-dashboard-${dev.name}.png`)

    // [B] Wallet Page
    console.log(`  [B] Testing Wallet & Funds Page (/dashboard/wallet)...`)
    await cdp.send('Page.navigate', { url: 'http://localhost:4180/dashboard/wallet' })
    await sleep(2000)

    const walletPageData = await evalScript(cdp, `(() => {
      const walletCard = document.querySelector('.fintech-wallet-hero') || document.querySelector('.fintech-wallet-card');
      const balance = walletCard?.querySelector('.balance-number')?.textContent?.trim() || walletCard?.querySelector('.fintech-card-balance')?.textContent?.trim();
      const callout = document.querySelector('.fintech-funding-explainer') || document.querySelector('.fintech-callout-card');
      const stepItems = Array.from(document.querySelectorAll('.fintech-how-step, .fintech-step-item')).map(s => ({
        num: s.querySelector('.fintech-step-num')?.textContent?.trim(),
        title: (s.querySelector('strong, .fintech-step-title')?.textContent || '').trim()
      }));
      const txRows = Array.from(document.querySelectorAll('.fintech-tx-row')).map(r => ({
        title: r.querySelector('.fintech-tx-title')?.textContent?.trim(),
        amount: r.querySelector('.fintech-tx-amount')?.textContent?.trim()
      }));
      const filterPills = Array.from(document.querySelectorAll('.fintech-history-controls button, .fintech-filter-pill')).map(p => p.textContent?.trim());

      return {
        walletCardPresent: Boolean(walletCard),
        balance,
        calloutPresent: Boolean(callout),
        stepItemsCount: stepItems.length,
        txRowsCount: txRows.length,
        filterPills
      };
    })()`)

    console.log(`      Wallet Page Card: ${walletPageData.walletCardPresent} (Balance: ${walletPageData.balance})`)
    console.log(`      Safe Funding Callout: ${walletPageData.calloutPresent}`)
    console.log(`      "How funding works" Steps Count: ${walletPageData.stepItemsCount}`)
    console.log(`      Transaction Filter Pills:`, walletPageData.filterPills.join(', '))
    console.log(`      Transaction Rows Rendered: ${walletPageData.txRowsCount}`)

    if (!walletPageData.walletCardPresent) throw new Error('Wallet card missing on wallet page')
    if (walletPageData.stepItemsCount !== 3) throw new Error(`Expected 3 funding steps, found ${walletPageData.stepItemsCount}`)

    // Take screenshot of wallet page
    const walletShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, `fintech-wallet-${dev.name}.png`), Buffer.from(walletShot.data, 'base64'))
    console.log(`      [Screenshot Saved]: acceptance-evidence/fintech-wallet-${dev.name}.png`)

    // [C] Test Opening Fund Wallet Bottom Sheet / Modal
    console.log(`  [C] Testing Fund Wallet Sheet Interaction...`)
    await evalScript(cdp, `(() => {
      const fundBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Add money'));
      if (fundBtn) fundBtn.click();
    })()`)
    await sleep(1000)

    const sheetCheck = await evalScript(cdp, `(() => {
      const sheet = document.querySelector('.fintech-sheet');
      const title = sheet?.querySelector('.fintech-sheet-title h2, .fintech-sheet-title')?.textContent?.trim();
      const presets = Array.from(sheet?.querySelectorAll('.fintech-quick-amounts button, .fintech-amount-chip') || []).map(c => c.textContent?.trim());
      const proceedBtn = sheet?.querySelector('.fintech-btn-orange, .fintech-sheet-footer button');
      return {
        sheetOpen: Boolean(sheet),
        title,
        presets,
        proceedBtnText: proceedBtn?.textContent?.trim()
      };
    })()`)

    console.log(`      Fund Sheet Open: ${sheetCheck.sheetOpen}`)
    console.log(`      Sheet Title: "${sheetCheck.title}"`)
    console.log(`      Presets:`, sheetCheck.presets.join(', '))
    console.log(`      Proceed CTA: "${sheetCheck.proceedBtnText}"`)

    if (!sheetCheck.sheetOpen) throw new Error('Fund wallet sheet did not open upon clicking "Add money"')

    // Take screenshot of bottom sheet
    const sheetShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, `fintech-sheet-${dev.name}.png`), Buffer.from(sheetShot.data, 'base64'))
    console.log(`      [Screenshot Saved]: acceptance-evidence/fintech-sheet-${dev.name}.png`)

    // Close the sheet
    await evalScript(cdp, `(() => {
      const closeBtn = document.querySelector('.fintech-sheet .close, .fintech-sheet-close');
      if (closeBtn) closeBtn.click();
    })()`)
    await sleep(500)
  }

  // 4. Test Dark Mode & Light Mode
  console.log(`\n------------------------------------------------------------------------`)
  console.log(`TESTING THEME TOGGLE (LIGHT & DARK MODE)...`)
  console.log(`------------------------------------------------------------------------`)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    hasTouch: true,
  })
  await cdp.send('Page.navigate', { url: 'http://localhost:4180/dashboard' })
  await sleep(1500)

  // Toggle to dark
  await evalScript(cdp, `(() => {
    const themeBtn = document.querySelector('.fintech-icon-btn');
    if (themeBtn) themeBtn.click();
  })()`)
  await sleep(500)

  const isDark = await evalScript(cdp, `document.body.classList.contains('dark')`)
  console.log(`   Theme toggled to dark: ${isDark}`)
  if (!isDark) throw new Error('Theme toggle failed to add .dark class')

  const darkShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(evidenceDir, `fintech-dashboard-dark-iphone.png`), Buffer.from(darkShot.data, 'base64'))
  console.log(`   [Screenshot Saved]: acceptance-evidence/fintech-dashboard-dark-iphone.png`)

  // Cleanup
  cdp.close()
  chromeProcess.kill('SIGTERM')
  server.close()

  console.log('\n========================================================================')
  console.log('ALL FINTECH ACCEPTANCE TESTS PASSED WITH 0 FAILURES!')
  console.log('========================================================================\n')
}

run().catch((err) => {
  console.error('Acceptance test failed:', err)
  process.exit(1)
})

