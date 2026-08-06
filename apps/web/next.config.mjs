/**
 * Static export on purpose.
 *
 * Every number this site shows is read from the chain in the visitor's own
 * browser, so there is no server to render it and nothing for a backend to
 * quietly get wrong. A dashboard for a project about not trusting claims should
 * not ask to be trusted; a static bundle plus a public RPC is checkable by
 * whoever is looking at it.
 */
const repo = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  basePath: repo,
  images: { unoptimized: true },
  trailingSlash: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};
