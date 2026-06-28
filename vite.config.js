import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Native bridge plugins (incl. @capacitor-firebase) — keep together
          if (
            id.includes('@capacitor') ||
            id.includes('@capawesome') ||
            id.includes('@capgo') ||
            id.includes('@revenuecat')
          ) return 'capacitor'
          // Firebase web SDK — the largest dependency
          if (id.includes('/firebase/') || id.includes('@firebase')) return 'firebase'
          if (id.includes('@sentry')) return 'sentry'
          // Heavy canvas/image-rendering libs (only used for share images)
          if (id.includes('html2canvas') || id.includes('html-to-image')) return 'imaging'
          if (id.includes('@tabler/icons') || id.includes('lucide-react')) return 'icons'
          if (id.includes('body-highlighter') || id.includes('muscle-highlighter')) return 'highlighter'
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  esbuild: {
    drop: ['console', 'debugger']
  }
})
