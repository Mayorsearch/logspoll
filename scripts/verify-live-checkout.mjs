import { spawn } from 'node:child_process'

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

async function verifyLive() {
  console.log('1. Launching headless Chrome...')
  const chromeProcess = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--user-data-dir=/tmp/chrome-live-checkout-profile',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,800',
    ],
    { stdio: 'ignore' }
  )

  let versionRes = null
  for (let i = 0; i < 20; i++) {
    try {
      versionRes = await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' })
      if (versionRes.ok) break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  if (!versionRes) throw new Error('Chrome failed to open debug port')

  try {
    const target = await versionRes.json()
    const cdp = new CdpClient(target.webSocketDebuggerUrl)
    await cdp.connect()

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    const viewports = [
      { width: 320, height: 640, label: '320px (iPhone SE)' },
      { width: 360, height: 740, label: '360px (Compact Android)' },
      { width: 375, height: 667, label: '375px (iPhone 8/SE)' },
      { width: 390, height: 844, label: '390px (iPhone 12/13/14)' },
      { width: 414, height: 896, label: '414px (iPhone XR/Plus)' },
      { width: 430, height: 932, label: '430px (iPhone Pro Max)' },
    ]

    const results = []

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: true,
      })

      await cdp.send('Page.navigate', { url: 'https://logspoll.com/checkout' })
      await new Promise((r) => setTimeout(r, 2000))

      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const doc = document.documentElement;
          const body = document.body;
          const windowW = window.innerWidth;
          const scrollW = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
          const clientW = doc.clientWidth;
          
          let overflowElCount = 0;
          document.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.right > windowW + 1) overflowElCount++;
          });

          return {
            windowW,
            scrollW,
            clientW,
            overflowElCount,
            passed: scrollW <= clientW + 1 && overflowElCount === 0
          };
        })()`,
        returnByValue: true,
      })

      const val = evalRes.result.value
      results.push({
        Viewport: `${vp.width}px`,
        Label: vp.label,
        'Window Width': `${val.windowW}px`,
        'Scroll Width': `${val.scrollW}px`,
        'Client Width': `${val.clientW}px`,
        'Overflow Count': val.overflowElCount,
        Status: val.passed ? 'PASS' : 'FAIL',
      })
    }

    cdp.close()

    console.log('\n============================================================')
    console.log('LIVE PRODUCTION (https://logspoll.com/checkout) RESPONSIVE REPORT')
    console.log('============================================================')
    console.table(results)
  } finally {
    chromeProcess.kill()
  }
}

verifyLive().catch((e) => {
  console.error(e)
  process.exit(1)
})

