"use client";
import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, ShoppingBag, X } from "lucide-react";
export function CartNotice() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        className="icon-button cart-button"
        aria-label="Open cart information"
        onClick={() => dialog.current?.showModal()}
      >
        <ShoppingBag size={21} />
        <span className="cart-count">0</span>
      </button>
      <dialog
        ref={dialog}
        className="notice-dialog"
        aria-labelledby="cart-title"
      >
        <button
          className="icon-button dialog-close"
          aria-label="Close cart information"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <span className="notice-icon">
          <ShoppingBag size={26} />
        </span>
        <p className="eyebrow">CHECKOUT UNAVAILABLE</p>
        <h2 id="cart-title">A little exploring first.</h2>
        <p>
          Shopping carts and checkout will be available after customer accounts
          and verified payments are connected. No purchases can be made yet.
        </p>
        <Link
          href="/marketplace"
          className="button button-dark"
          onClick={() => dialog.current?.close()}
        >
          Explore products <ArrowUpRight size={17} />
        </Link>
      </dialog>
    </>
  );
}
