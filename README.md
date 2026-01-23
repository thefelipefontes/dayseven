# Streakd 🔥

**Win the week.** Track your fitness streaks across lifts, runs, and recovery.

## Quick Deploy to Vercel

### Option 1: GitHub + Vercel (Recommended)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create streakd --private --source=. --push
   ```

2. **Deploy on Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your `streakd` repository
   - Click **Deploy** (Vercel auto-detects Vite)
   - Done! Your app is live.

3. **Connect your domain:**
   - In Vercel dashboard → Settings → Domains
   - Add `streakd.app` (or your domain)
   - Update DNS as instructed

### Option 2: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Project Structure

```
streakd-app/
├── src/
│   ├── App.jsx      # Main app component
│   ├── main.jsx     # Entry point
│   └── index.css    # Tailwind + custom styles
├── public/
│   ├── manifest.json    # PWA manifest
│   └── favicon.svg      # App icon
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Next Steps

- [ ] Set up Supabase for auth & database
- [ ] Apply for Whoop API access
- [ ] Add real data persistence
- [ ] Create app icons (192x192 and 512x512 PNG)
- [ ] Submit to App Store via PWA or Capacitor

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Vercel** - Hosting

---

Built with 💪 for people who don't miss.
