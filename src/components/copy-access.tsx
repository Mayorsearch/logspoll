"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
export function CopyAccess({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="copy-access">
      <button
        type="button"
        className="button button-outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied to clipboard.");
          } catch {
            setStatus(
              "Copy is unavailable. Select the instructions below to copy them.",
            );
          }
        }}
      >
        <Copy size={15} />
        Copy instructions
      </button>
      <span role="status">{status}</span>
    </div>
  );
}
