import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

// Simple static HTTP server for dist/
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
    let filePath = path.join(distDir, req.url.split('?')[0])
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

// Simple CDP client over native WebSocket
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

async function run() {
  console.log('1. Starting local static server on port 4173...')
  const server = await startServer(4173)

  console.log('2. Launching headless Chrome...')
  const chromeProcess = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--user-data-dir=/tmp/chrome-checkout-test-profile',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,800',
    ],
    { stdio: 'ignore' }
  )

  // Poll until debug port is open (up to 5 seconds)
  let versionRes = null
  for (let i = 0; i < 20; i++) {
    try {
      versionRes = await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' })
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

    const viewports = [
      { width: 320, height: 640, label: '320px (iPhone SE / Ultra Small)' },
      { width: 360, height: 740, label: '360px (Galaxy S8 / Compact Android)' },
      { width: 375, height: 667, label: '375px (iPhone 8 / SE2 / Mini)' },
      { width: 390, height: 844, label: '390px (iPhone 12/13/14 Standard)' },
      { width: 414, height: 896, label: '414px (iPhone XR / Plus)' },
      { width: 430, height: 932, label: '430px (iPhone 14/15/16 Pro Max)' },
    ]

    let allPassed = true
    const results = []

    for (const vp of viewports) {
      console.log(`\nTesting Viewport: ${vp.label} [${vp.width}x${vp.height}]...`)

      // Set device metrics
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: true,
      })

      // Navigate to checkout
      await cdp.send('Page.navigate', { url: 'http://localhost:4173/checkout' })

      // Wait for rendering
      await new Promise((r) => setTimeout(r, 1200))

      // Populate mock items in localStorage and re-render
      await cdp.send('Runtime.evaluate', {
        expression: `
          localStorage.setItem('logspoll-cart', JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', quantity: 1 }]));
          window.location.reload();
        `,
      })

      await new Promise((r) => setTimeout(r, 1200))

      // Evaluate responsiveness without overflow-x: hidden concealment
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const doc = document.documentElement;
          const body = document.body;
          const windowW = window.innerWidth;
          const scrollW = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
          const clientW = doc.clientWidth;
          
          const overflowingElements = [];
          document.querySelectorAll('*').forEach(el => {
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
            hasOverflow: scrollW > clientW + 1,
            overflowCount: overflowingElements.length,
            overflowingElements: overflowingElements.slice(0, 5)
          };
        })()`,
        returnByValue: true,
      })

      const val = evalRes.result.value
      const passed = !val.hasOverflow && val.overflowCount === 0

      results.push({
        viewport: vp.width,
        label: vp.label,
        windowW: val.windowW,
        scrollW: val.scrollW,
        clientW: val.clientW,
        passed,
        overflowingElements: val.overflowingElements,
      })

      if (passed) {
        console.log(`  ✔ PASS: scrollWidth (${val.scrollW}px) <= clientWidth (${val.clientW}px). No overflowing elements.`)
      } else {
        allPassed = false
        console.log(`  ✘ FAIL: scrollWidth (${val.scrollW}px) > clientWidth (${val.clientW}px) by ${val.scrollW - val.clientW}px!`)
        console.log('  Overflowing elements:', val.overflowingElements)
      }
    }

    cdp.close()

    console.log('\n==================================================')
    console.log('MOBILE CHECKOUT RESPONSIVENESS VERIFICATION REPORT')
    console.log('==================================================')
    console.table(
      results.map((r) => ({
        Viewport: `${r.viewport}px`,
        Label: r.label.split(' (')[0],
        'Window Width': `${r.windowW}px`,
        'Scroll Width': `${r.scrollW}px`,
        'Client Width': `${r.clientW}px`,
        Status: r.passed ? 'PASS' : 'FAIL',
      }))
    )

    if (!allPassed) {
      console.error('\nMobile checkout responsiveness test FAILED.')
      process.exit(1)
    } else {
      console.log('\nAll 6 mobile viewports passed perfectly with zero horizontal overflow!')
    }
  } finally {
    chromeProcess.kill()
    server.close()
  }
}

run().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
