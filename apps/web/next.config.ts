import type { NextConfig } from "next";

const scriptSrc = ["'self'", "'unsafe-inline'", process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://evm-testnet.qore.host",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/qore-rest/cosmos/tx/v1beta1/txs/:hash",
        destination: "https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/:hash",
      },
    ];
  },
  async redirects() {
    return [
      { source: "/live", destination: "/gate", permanent: false },
      { source: "/app", destination: "/try", permanent: false },
    ];
  },
};

export default nextConfig;
