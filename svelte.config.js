import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: '404.html' }),
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'https://lastfm.freetls.fastly.net'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self', 'https://discord.com', 'https://www.last.fm'],
      },
    },
  },
}
