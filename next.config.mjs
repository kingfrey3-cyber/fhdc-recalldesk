/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the bottom-left Next.js development indicator/pill on localhost.
  // It does not appear in production, but it was distracting during testing.
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb'
    }
  }
};

export default nextConfig;
