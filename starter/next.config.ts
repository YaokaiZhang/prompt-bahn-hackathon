import type { NextConfig } from "next"

// 127.0.0.1 is how a forwarded port is often opened; Next blocks dev resources for origins it does not know.
const config: NextConfig = { devIndicators: false, allowedDevOrigins: ["127.0.0.1"] }

export default config
