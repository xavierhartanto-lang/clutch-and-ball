/**
 * Minimal Worker: serve static files from the assets binding.
 * Deploy with: npx wrangler deploy
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") {
      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
    }
    return env.ASSETS.fetch(request);
  },
};
