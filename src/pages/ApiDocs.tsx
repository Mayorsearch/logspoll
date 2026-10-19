import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { 
  BookOpen, Terminal, Key, Layers, Package, CheckCircle2, ShoppingBag, 
  CreditCard, Webhook, AlertTriangle, ShieldCheck, Code2, History, 
  Copy, Check, Search, ExternalLink, Menu, X
} from 'lucide-react'
import './api-docs.css'

interface DocSection {
  id: string
  number: number
  title: string
  icon: typeof BookOpen
  description: string
  method?: 'GET' | 'POST' | 'DELETE'
  endpoint?: string
  auth?: 'Public' | 'Bearer API Key' | 'Session / API Key'
}

const SECTIONS: DocSection[] = [
  { id: 'introduction', number: 1, title: 'Introduction', icon: BookOpen, description: 'Overview of the LogsPoll REST API, capabilities, and developer ecosystem.' },
  { id: 'getting-started', number: 2, title: 'Getting Started', icon: Terminal, description: 'Quickstart guide to integrating LogsPoll into your application or bot.' },
  { id: 'authentication', number: 3, title: 'Authentication', icon: Key, description: 'How to authenticate API requests via Bearer Tokens and Session Headers.' },
  { id: 'api-keys', number: 4, title: 'API Keys', icon: ShieldCheck, description: 'Generating, securing, scoping, and rotating customer API keys.' },
  { id: 'categories', number: 5, title: 'Categories', icon: Layers, method: 'GET', endpoint: '/api/v1/categories', auth: 'Public', description: 'Retrieve canonical platform categories and active product counts.' },
  { id: 'products', number: 6, title: 'Products Catalog', icon: Package, method: 'GET', endpoint: '/api/v1/products', auth: 'Public', description: 'Query published digital products with server, category, and availability filters.' },
  { id: 'product-availability', number: 7, title: 'Product Availability', icon: CheckCircle2, method: 'GET', endpoint: '/api/v1/products/:slug', auth: 'Public', description: 'Verify real-time stock levels, pricing, and fulfillment attributes for a single product.' },
  { id: 'orders', number: 8, title: 'Orders & Purchases', icon: ShoppingBag, method: 'GET', endpoint: '/api/v1/orders', auth: 'Bearer API Key', description: 'List customer order history and access delivered digital product credentials.' },
  { id: 'checkout', number: 9, title: 'Checkout & Payments', icon: CreditCard, method: 'POST', endpoint: '/api/v1/checkout', auth: 'Bearer API Key', description: 'Initiate a secure order checkout session powered by Bachs Payment Gateway.' },
  { id: 'payment-status', number: 10, title: 'Payment Status', icon: CheckCircle2, method: 'GET', endpoint: '/api/v1/orders/:id/status', auth: 'Bearer API Key', description: 'Check real-time payment reconciliation and fulfillment dispatch status.' },
  { id: 'webhooks', number: 11, title: 'Customer Webhooks', icon: Webhook, description: 'Receive signed real-time notifications when your orders are confirmed, paid, or delivered.' },
  { id: 'error-codes', number: 12, title: 'Error Codes', icon: AlertTriangle, description: 'Comprehensive guide to HTTP status codes and structured error responses.' },
  { id: 'rate-limits', number: 13, title: 'Rate Limits', icon: ShieldCheck, description: 'Understand request throttling (60 requests/minute) and burst protections.' },
  { id: 'security', number: 14, title: 'Security & Privacy', icon: ShieldCheck, description: 'Our zero-leakage guarantee: strict D1 isolation, TLS 1.3, and server anonymization.' },
  { id: 'examples', number: 15, title: 'Full Workflow Examples', icon: Code2, description: 'End-to-end integration examples in cURL, JavaScript Fetch, and Node.js.' },
  { id: 'changelog', number: 16, title: 'API Changelog', icon: History, description: 'Versioning policy and record of updates to the LogsPoll Customer API.' }
]

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="docs-code-container">
      <div className="docs-code-header">
        <span className="docs-code-lang">{language}</span>
        <button 
          onClick={handleCopy} 
          className="docs-copy-btn" 
          aria-label="Copy code to clipboard"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="docs-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function ApiDocs() {
  const [search, setSearch] = useState('')
  const [activeSection, setActiveSection] = useState('introduction')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS
    const q = search.toLowerCase()
    return SECTIONS.filter(s => 
      s.title.toLowerCase().includes(q) || 
      s.description.toLowerCase().includes(q) || 
      (s.endpoint && s.endpoint.toLowerCase().includes(q))
    )
  }, [search])

  return (
    <div className="docs-page-shell">
      {/* Top Navigation Bar */}
      <header className="docs-topbar">
        <div className="docs-topbar-left">
          <Link to="/" className="docs-brand" aria-label="LogsPoll Home">
            Logs<span>Poll</span> <span className="docs-badge">Developers</span>
          </Link>
          <span className="docs-version">v1.0.0</span>
        </div>

        <div className="docs-search-wrapper">
          <Search size={16} className="docs-search-icon" />
          <input 
            type="search" 
            placeholder="Search API reference..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="docs-search-input"
            aria-label="Search API documentation"
          />
        </div>

        <div className="docs-topbar-actions">
          <Link to="/marketplace" className="docs-toplink">
            Marketplace <ExternalLink size={13} />
          </Link>
          <Link to="/dashboard" className="docs-toplink">
            Dashboard
          </Link>
          <button 
            className="docs-mobile-toggle" 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <div className="docs-layout">
        {/* Sidebar */}
        <aside className={`docs-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
          <div className="docs-sidebar-header">
            <h3>API Documentation</h3>
            <p>Customer & Developer REST APIs</p>
          </div>
          <nav className="docs-nav" aria-label="API Documentation Sections">
            {filteredSections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => {
                    setActiveSection(section.id)
                    setMobileMenuOpen(false)
                  }}
                  className={`docs-nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="docs-nav-num">{section.number}.</span>
                  <Icon size={16} className="docs-nav-icon" />
                  <span className="docs-nav-label">{section.title}</span>
                  {section.method && (
                    <span className={`docs-method-pill ${section.method.toLowerCase()}`}>
                      {section.method}
                    </span>
                  )}
                </a>
              )
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="docs-content" id="main-docs">
          <div className="docs-hero-card">
            <span className="docs-eyebrow">OFFICIAL DEVELOPER REFERENCE</span>
            <h1>LogsPoll Developer & Customer API</h1>
            <p>
              Integrate LogsPoll’s private digital essentials marketplace into your automated workflows, 
              custom bots, and internal systems. Access verified digital products, real-time stock availability, 
              secure Bachs checkout sessions, and automated digital delivery.
            </p>
            <div className="docs-hero-meta">
              <div><strong>Base URL:</strong> <code>https://logspoll.com/api/v1</code></div>
              <div><strong>Format:</strong> <code>application/json</code></div>
              <div><strong>Authentication:</strong> <code>Bearer Token / Session Cookie</code></div>
            </div>
          </div>

          {/* Section 1: Introduction */}
          <section id="introduction" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">01</span>
              <h2>Introduction</h2>
            </div>
            <p>
              The LogsPoll REST API allows authorized developers and corporate customers to browse the 
              product marketplace, query verified inventory across multiple logical supplier servers (Server 1, Server 2, Server 3), 
              reserve stock, initiate Bachs checkout, and retrieve purchase fulfillment credentials.
            </p>
            <div className="docs-callout note">
              <strong>Core Principles:</strong>
              <ul>
                <li><strong>Predictable REST:</strong> Standard HTTP verbs, consistent JSON error responses, and deterministic status codes.</li>
                <li><strong>Strict Privacy:</strong> Upstream supplier identities, wholesale costs, and credentials remain private. Public endpoints only expose clean <code>Server 1</code>, <code>Server 2</code>, or <code>Server 3</code> tier identifiers.</li>
                <li><strong>Settlement Safety:</strong> All orders settle in Nigerian Naira (NGN) via Bachs Payment Gateway with authoritative backend validation.</li>
              </ul>
            </div>
          </section>

          {/* Section 2: Getting Started */}
          <section id="getting-started" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">02</span>
              <h2>Getting Started</h2>
            </div>
            <p>
              To make your first API request, all public catalog endpoints (such as categories and product search) 
              can be queried immediately without authentication. For creating orders and accessing delivery entitlements, 
              obtain an API key from your customer dashboard.
            </p>
            <p>Test your connection using cURL:</p>
            <CodeBlock 
              language="bash" 
              code={`curl -X GET "https://logspoll.com/api/v1/products?availability=in-stock" \\
  -H "Accept: application/json"`} 
            />
          </section>

          {/* Section 3: Authentication */}
          <section id="authentication" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">03</span>
              <h2>Authentication</h2>
            </div>
            <p>
              The LogsPoll API supports two secure authentication modes:
            </p>
            <ol className="docs-list">
              <li>
                <strong>Bearer Token Authentication (Recommended for API clients):</strong>
                <p>Pass your secret API key in the <code>Authorization</code> header:</p>
                <CodeBlock language="bash" code={`Authorization: Bearer lp_live_0192837465abcdef...`} />
              </li>
              <li>
                <strong>HttpOnly Cookie Session (For web apps):</strong>
                <p>Browser clients authenticated through Better Auth automatically send signed, secure session cookies (<code>credentials: same-origin</code>).</p>
              </li>
            </ol>
            <div className="docs-callout warning">
              <strong>Security Warning:</strong> Never expose your API key in client-side code, public GitHub repositories, or frontend bundles. All requests must be made over HTTPS.
            </div>
          </section>

          {/* Section 4: API Keys */}
          <section id="api-keys" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">04</span>
              <h2>API Key Management</h2>
            </div>
            <p>
              API keys are cryptographically generated using high-entropy random identifiers (<code>lp_live_...</code>).
              Only the SHA-256 hash of the key is stored in LogsPoll Cloudflare D1 database.
            </p>
            <div className="docs-table-wrapper">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>read:catalog</code></td>
                    <td>Query products, categories, and real-time inventory levels.</td>
                  </tr>
                  <tr>
                    <td><code>orders:create</code></td>
                    <td>Create new customer orders and Bachs checkout sessions.</td>
                  </tr>
                  <tr>
                    <td><code>orders:read</code></td>
                    <td>Read past orders, payment receipts, and delivered credentials.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 5: Categories */}
          <section id="categories" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">05</span>
              <h2>Categories</h2>
              <span className="docs-method-pill get">GET</span>
              <code className="docs-endpoint-tag">/api/v1/categories</code>
            </div>
            <p>
              Retrieve canonical unified categories (Facebook, Instagram, Twitter/X, TikTok, Gmail, VPN) 
              grouping products from all three servers.
            </p>
            <h3>cURL Request:</h3>
            <CodeBlock 
              language="bash"
              code={`curl -s "https://logspoll.com/api/v1/categories" \\
  -H "Accept: application/json"`}
            />
            <h3>Response (200 OK):</h3>
            <CodeBlock 
              language="json"
              code={`{
  "records": [
    {
      "id": "cat_fb_01",
      "slug": "facebook",
      "name": "Facebook",
      "short_name": "Facebook",
      "description": "Verified personal and aged Facebook accounts across all server tiers.",
      "product_count": 18,
      "in_stock_count": 17
    },
    {
      "id": "cat_ig_02",
      "slug": "instagram",
      "name": "Instagram",
      "short_name": "Instagram",
      "description": "Aged and niche Instagram accounts with organic history.",
      "product_count": 12,
      "in_stock_count": 10
    }
  ]
}`}
            />
          </section>

          {/* Section 6: Products */}
          <section id="products" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">06</span>
              <h2>Products Catalog</h2>
              <span className="docs-method-pill get">GET</span>
              <code className="docs-endpoint-tag">/api/v1/products</code>
            </div>
            <p>
              Query published products with flexible filtering. Products from all three servers appear unified 
              under canonical categories while retaining independent server numbers.
            </p>
            <h3>Query Parameters:</h3>
            <div className="docs-table-wrapper">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>main_category</code></td>
                    <td>string</td>
                    <td>Filter by unified platform: <code>facebook</code>, <code>instagram</code>, <code>tiktok</code>, <code>twitter</code>, <code>gmail</code>, <code>vpn</code>.</td>
                  </tr>
                  <tr>
                    <td><code>server</code></td>
                    <td>number</td>
                    <td>Filter by logical supplier server tier: <code>1</code>, <code>2</code>, or <code>3</code>.</td>
                  </tr>
                  <tr>
                    <td><code>availability</code></td>
                    <td>string</td>
                    <td>Filter by stock: <code>in-stock</code> or <code>out-of-stock</code>.</td>
                  </tr>
                  <tr>
                    <td><code>q</code></td>
                    <td>string</td>
                    <td>Search keyword matching product title or description.</td>
                  </tr>
                  <tr>
                    <td><code>sort</code></td>
                    <td>string</td>
                    <td>Sorting: <code>featured</code>, <code>price-asc</code>, <code>price-desc</code>, <code>newest</code>.</td>
                  </tr>
                  <tr>
                    <td><code>page</code></td>
                    <td>number</td>
                    <td>Pagination page index (default: 1, 20 items per page).</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h3>cURL Request:</h3>
            <CodeBlock 
              language="bash"
              code={`curl -s "https://logspoll.com/api/v1/products?main_category=facebook&server=2&availability=in-stock" \\
  -H "Accept: application/json"`}
            />
            <h3>Response (200 OK):</h3>
            <CodeBlock 
              language="json"
              code={`{
  "products": [
    {
      "id": "aa646cb4-b097-4c83-b7de-87feba0dd356",
      "slug": "ypg-e684a60a-5e08-4943-8245-f52cdc7ca768-1035",
      "name": "2024-25 Vietnam 🇻🇳 Facebook Profile",
      "category_name": "Facebook",
      "category_slug": "facebook",
      "price_minor": 150000,
      "currency": "NGN",
      "available_quantity": 42,
      "server_number": 2,
      "delivery_type": "Manual fulfillment",
      "features": ["2FA Enabled", "Cookie Included", "Email Access"]
    }
  ],
  "total": 1,
  "pages": 1
}`}
            />
          </section>

          {/* Section 7: Product Availability */}
          <section id="product-availability" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">07</span>
              <h2>Product Availability</h2>
              <span className="docs-method-pill get">GET</span>
              <code className="docs-endpoint-tag">/api/v1/products/:slug</code>
            </div>
            <p>
              Retrieve single product details with real-time verified stock availability.
            </p>
            <CodeBlock 
              language="bash"
              code={`curl -s "https://logspoll.com/api/v1/products?slug=ypg-e684a60a-5e08-4943-8245-f52cdc7ca768-1035" \\
  -H "Accept: application/json"`}
            />
          </section>

          {/* Section 8: Orders */}
          <section id="orders" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">08</span>
              <h2>Orders & Purchases</h2>
              <span className="docs-method-pill get">GET</span>
              <code className="docs-endpoint-tag">/api/v1/orders</code>
            </div>
            <p>
              Retrieve customer orders. When <code>?purchases=true</code> is supplied, this endpoint returns 
              delivered items alongside their digital delivery instructions and account credentials.
            </p>
            <h3>cURL Request:</h3>
            <CodeBlock 
              language="bash"
              code={`curl -s "https://logspoll.com/api/v1/orders?purchases=true" \\
  -H "Authorization: Bearer lp_live_sample_key" \\
  -H "Accept: application/json"`}
            />
            <h3>Response (200 OK):</h3>
            <CodeBlock 
              language="json"
              code={`{
  "records": [
    {
      "id": "ord_987162534",
      "reference": "LP-ORD-20261017-01",
      "payment_status": "paid",
      "fulfillment_status": "delivered",
      "total_minor": 150000,
      "currency": "NGN",
      "created_at": "2026-10-17T02:20:00.000Z",
      "order_items": [
        {
          "id": "item_123",
          "product_name": "2024-25 Vietnam 🇻🇳 Facebook Profile",
          "quantity": 1,
          "product_entitlements": {
            "instructions": "UID: 10008892182 | PASS: SecurePass!2026 | 2FA: JBSWY3DPEHPK3PXP"
          }
        }
      ]
    }
  ]
}`}
            />
          </section>

          {/* Section 9: Checkout */}
          <section id="checkout" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">09</span>
              <h2>Checkout & Payments</h2>
              <span className="docs-method-pill post">POST</span>
              <code className="docs-endpoint-tag">/api/v1/checkout</code>
            </div>
            <p>
              Initiates an order and creates a secure Bachs checkout session. All amounts are strictly validated 
              against the verified database price.
            </p>
            <h3>Request Body:</h3>
            <CodeBlock 
              language="json"
              code={`{
  "items": [
    {
      "product_id": "aa646cb4-b097-4c83-b7de-87feba0dd356",
      "quantity": 1
    }
  ],
  "redirect_url": "https://yourapp.com/order-confirmation"
}`}
            />
            <h3>Response (200 OK):</h3>
            <CodeBlock 
              language="json"
              code={`{
  "order_id": "ord_987162534",
  "reference": "LP-ORD-20261017-01",
  "total_minor": 150000,
  "currency": "NGN",
  "checkout_url": "https://bachs.africa/checkout/session_abc123",
  "status": "pending_payment"
}`}
            />
          </section>

          {/* Section 10: Payment Status */}
          <section id="payment-status" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">10</span>
              <h2>Payment Status & Reconciliation</h2>
              <span className="docs-method-pill get">GET</span>
              <code className="docs-endpoint-tag">/api/v1/orders/:id/status</code>
            </div>
            <p>
              Check the authoritative payment status of an order. LogsPoll reconciles pending checkout 
              sessions against Bachs to ensure real-time accuracy.
            </p>
            <CodeBlock 
              language="bash"
              code={`curl -s "https://logspoll.com/api/v1/orders/ord_987162534/status" \\
  -H "Authorization: Bearer lp_live_sample_key"`}
            />
          </section>

          {/* Section 11: Webhooks */}
          <section id="webhooks" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">11</span>
              <h2>Customer Webhooks</h2>
            </div>
            <p>
              Configure webhook endpoints to receive instant HTTP POST callbacks when order events occur.
              Every webhook request includes an HMAC SHA-256 signature in the <code>X-LogsPoll-Signature</code> header.
            </p>
            <h3>Supported Events:</h3>
            <ul className="docs-list">
              <li><code>order.placed</code> — Order was created and awaiting payment.</li>
              <li><code>payment.successful</code> — Payment was authoritatively reconciled via Bachs.</li>
              <li><code>order.fulfilled</code> — Digital goods and credentials were delivered.</li>
              <li><code>payment.failed</code> — Checkout expired, canceled, or declined.</li>
              <li><code>refund.completed</code> — Order payment was refunded.</li>
            </ul>
          </section>

          {/* Section 12: Error Codes */}
          <section id="error-codes" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">12</span>
              <h2>Error Codes & Troubleshooting</h2>
            </div>
            <p>
              LogsPoll returns standard HTTP response codes. Failed responses include a JSON payload with a human-readable <code>error</code> or <code>message</code> attribute.
            </p>
            <div className="docs-table-wrapper">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>400 Bad Request</code></td>
                    <td>Invalid Input</td>
                    <td>Malformed JSON, invalid product ID, or out-of-range quantity.</td>
                  </tr>
                  <tr>
                    <td><code>401 Unauthorized</code></td>
                    <td>Authentication Required</td>
                    <td>Missing or invalid <code>Authorization: Bearer</code> token or expired session.</td>
                  </tr>
                  <tr>
                    <td><code>403 Forbidden</code></td>
                    <td>Access Denied</td>
                    <td>Account is unverified, deactivated, or lacks required permission.</td>
                  </tr>
                  <tr>
                    <td><code>404 Not Found</code></td>
                    <td>Resource Missing</td>
                    <td>Product or order could not be located.</td>
                  </tr>
                  <tr>
                    <td><code>429 Too Many Requests</code></td>
                    <td>Rate Limited</td>
                    <td>Exceeded 60 requests per minute limit. Retry after cooldown.</td>
                  </tr>
                  <tr>
                    <td><code>503 Unavailable</code></td>
                    <td>Database / Maintenance</td>
                    <td>Database synchronization or payment gateway is temporarily locked.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 13: Rate Limits */}
          <section id="rate-limits" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">13</span>
              <h2>Rate Limits</h2>
            </div>
            <p>
              To ensure platform reliability and fair usage, all API requests are rate-limited:
            </p>
            <ul>
              <li><strong>Public catalog queries:</strong> 60 requests per minute per IP.</li>
              <li><strong>Authenticated customer API:</strong> 120 requests per minute per API key.</li>
              <li><strong>Checkout creation:</strong> 10 requests per minute per customer account.</li>
            </ul>
          </section>

          {/* Section 14: Security */}
          <section id="security" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">14</span>
              <h2>Security & Supplier Privacy</h2>
            </div>
            <p>
              LogsPoll is built with defense-in-depth on Cloudflare’s global edge network:
            </p>
            <ul>
              <li><strong>Anonymized Supplier Architecture:</strong> All public catalog responses are strictly projected. Upstream supplier names, provider URLs, wholesale costs, and credentials never appear in API responses or frontend bundles.</li>
              <li><strong>D1 SQL Isolation:</strong> Production and staging databases are completely isolated with foreign key enforcement and role gates.</li>
              <li><strong>Credential Vaulting:</strong> Sensitive product entitlements are stored encrypted and only decrypted for authorized customers after payment status reaches <code>paid</code>.</li>
            </ul>
          </section>

          {/* Section 15: Examples */}
          <section id="examples" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">15</span>
              <h2>Integration Examples</h2>
            </div>
            <p>Full JavaScript/Node.js example querying available Facebook accounts and starting checkout:</p>
            <CodeBlock 
              language="javascript"
              code={`// Fetch in-stock Facebook accounts from Server 2
async function purchaseAccount() {
  const catalogRes = await fetch(
    'https://logspoll.com/api/v1/products?main_category=facebook&server=2&availability=in-stock'
  );
  const { products } = await catalogRes.json();
  
  if (!products.length) {
    console.log('No stock currently available');
    return;
  }
  
  const selectedProduct = products[0];
  console.log('Selected:', selectedProduct.name, 'Price:', selectedProduct.price_minor / 100);

  // Create Checkout Session
  const checkoutRes = await fetch('https://logspoll.com/api/v1/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer lp_live_YOUR_API_KEY'
    },
    body: JSON.stringify({
      items: [{ product_id: selectedProduct.id, quantity: 1 }],
      redirect_url: 'https://yourapp.com/success'
    })
  });

  const session = await checkoutRes.json();
  console.log('Redirect customer to:', session.checkout_url);
}

purchaseAccount();`}
            />
          </section>

          {/* Section 16: Changelog */}
          <section id="changelog" className="docs-card">
            <div className="docs-card-header">
              <span className="docs-section-tag">16</span>
              <h2>API Changelog</h2>
            </div>
            <div className="docs-changelog">
              <article className="docs-changelog-entry">
                <div className="docs-changelog-meta">
                  <span className="docs-version-tag">v1.0.0</span>
                  <span className="docs-date">October 2026</span>
                </div>
                <h4>Initial Public Developer API Release</h4>
                <ul>
                  <li>Launched unified category projections across Server 1, Server 2, and Server 3.</li>
                  <li>Integrated real-time verified stock availability from Cloudflare D1.</li>
                  <li>Automated order creation with Bachs payment gateway integration.</li>
                  <li>Added Bearer Token authentication and customer webhook support.</li>
                </ul>
              </article>
            </div>
          </section>

          {/* Footer of Documentation */}
          <footer className="docs-footer">
            <div>
              <p>Built with precision for professional operators and developers.</p>
              <small>LogsPoll Developer Platform · Built by SwiftNova Labs</small>
            </div>
            <div className="docs-footer-links">
              <Link to="/support">Contact Support</Link>
              <Link to="/marketplace">Explore Store</Link>
              <Link to="/terms">Terms of Service</Link>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
