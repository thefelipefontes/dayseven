import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// The version and build the Xcode project archives, for utils/appVersion.
const xcodeSetting = (name) => {
  try {
    const project = readFileSync(new URL('./ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8')
    return project.match(new RegExp(`${name} = ([^;]+);`))?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(xcodeSetting('MARKETING_VERSION')),
    __APP_BUILD__: JSON.stringify(xcodeSetting('CURRENT_PROJECT_VERSION')),
  },
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
          // Route map renderer (lazy-loaded when a route map first shows)
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('@tabler/icons') || id.includes('lucide-react')) return 'icons'
          if (id.includes('body-highlighter') || id.includes('muscle-highlighter')) return 'highlighter'
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  esbuild: {
    // Release builds strip console/debugger. KEEP_CONSOLE=1 keeps them for a device debug
    // run — Capacitor forwards console output to Xcode's console as "⚡️ [log]" lines.
    drop: process.env.KEEP_CONSOLE ? [] : ['console', 'debugger']
  }
})
