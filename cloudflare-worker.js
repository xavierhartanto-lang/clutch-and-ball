/**
 * Static assets Worker. "/" serves index.html (OAuth public home) by default.
 * Legacy URLs /welcome and /welcome.html also serve index.html.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/welcome" || path === "/welcome.html") {
      return env.ASSETS.fetch(
        new Request(`${url.origin}/index.html`, request),
      );
    }

    return env.ASSETS.fetch(request);
  },
};
