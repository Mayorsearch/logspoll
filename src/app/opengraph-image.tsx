import { ImageResponse } from "next/og";
export const alt = "LOGSPOLL — Your Digital Marketplace, Simplified.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#fcfaf7",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "76px 88px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: -1,
          color: "#111827",
        }}
      >
        LOGSPOLL<span style={{ color: "#f97316" }}>.</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -3,
          marginTop: 70,
          color: "#111827",
        }}
      >
        Your Digital Marketplace,
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -3,
          color: "#c44b08",
        }}
      >
        Simplified.
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 24,
          marginTop: 35,
          color: "#626976",
        }}
      >
        Your private digital services marketplace.
      </div>
      <div
        style={{
          display: "flex",
          width: 160,
          height: 8,
          background: "#f97316",
          marginTop: 50,
        }}
      />
    </div>,
    size,
  );
}
