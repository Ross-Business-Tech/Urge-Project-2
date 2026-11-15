import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { AI_CONFIG, gatewayOrigin } from './src/aiConfig.js'

// The built page only ever needs its own files, so tell the browser to refuse everything else. `connect-src` names the ONE
// address the page may talk to: the AI gateway (src/aiConfig.js), used only when a reviewer presses the button on the AI screen.
// If the AI screen is switched off there, it is `'none'` again: the page cannot make any network request at all, so "your
// workbook is never uploaded" is a rule the browser enforces, even if some library were compromised. Only added to the built
// page (the development server needs extra connections).
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${AI_CONFIG.enabled ? gatewayOrigin() : "'none'"}`,
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
