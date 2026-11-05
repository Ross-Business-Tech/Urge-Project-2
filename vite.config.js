import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The built page only ever needs its own files, so tell the browser to refuse everything else. `connect-src 'none'`
// means the page cannot make any network request at all, which turns "your workbook is never uploaded" from a promise
// into a rule the browser enforces, even if some library were compromised. Only added to the built page (the
// development server needs extra connections).
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy],
})
