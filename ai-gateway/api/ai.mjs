// The one file Vercel runs. It only connects Vercel to the real logic in lib/handler.mjs.
// Vercel's "fetch" export takes a standard Request and returns a standard Response.
import { handle } from '../lib/handler.mjs'

export default {
  fetch(request) {
    return handle(request, process.env)
  },
}
