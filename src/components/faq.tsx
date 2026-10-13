const questions = [
  ['What can I find on LOGSPOLL?', 'LOGSPOLL is being built for digital products and services, including VPN tools, business communication and email services. Available products will appear in the connected catalog.'],
  ['How much do products cost?', 'Prices will be shown on individual product listings once the live catalog is connected. No subscription plans or product prices are currently published.'],
  ['Can I place an order today?', 'Ordering is not available in this preview. Checkout and secure payment verification must be connected before purchases can be made.'],
  ['How will I access my purchases?', 'Sign in to your customer dashboard to view your orders and paid, delivered purchases. Account access requires the live Cloudflare connection.'],
]
export function FAQ() { return <div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div> }
