import { Plus } from "lucide-react";
export const faqs = [
  {
    question: "What can I find on LOGSPOLL?",
    answer:
      "LOGSPOLL is built for authorized digital subscriptions, licensed software and legitimate business tools. Register and verify your email to access product details, pricing and availability.",
  },
  {
    question: "How do I access the private catalog?",
    answer:
      "Create an account with your own email address, verify the link sent to your inbox and sign in. Registration and login become available once the authentication service is connected. Guests cannot view products, prices or inventory.",
  },
  {
    question: "I forgot my password. What should I do?",
    answer:
      "Use the Forgot password link on the login page to request a recovery email. Follow the recovery link and choose a new password of at least 12 characters. Never share your password or verification links.",
  },
  {
    question: "Can I buy products right now?",
    answer:
      "Not yet. Checkout will become available after payment processing and secure delivery have been configured and tested. No payment information is collected.",
  },
  {
    question: "How will digital products be delivered?",
    answer:
      "Each listing specifies licensed downloads, redemption codes, subscription activation or manual fulfillment. Delivery will require verified payment and will be accessible only to the purchaser.",
  },
  {
    question: "Which payment methods will be supported?",
    answer:
      "Paystack payments are planned, starting in test mode. Payment processing is not currently enabled.",
  },
  {
    question: "Why is the catalog private?",
    answer:
      "Product listings, prices and inventory are available only to verified, signed-in customers. Public pages describe our service categories without exposing private inventory.",
  },
];
export function FAQ() {
  return (
    <div className="faq-list">
      {faqs.map((faq, index) => (
        <details key={faq.question}>
          <summary>
            <span className="faq-number">0{index + 1}</span>
            <span>{faq.question}</span>
            <Plus className="faq-plus" size={17} />
          </summary>
          <p>{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}
