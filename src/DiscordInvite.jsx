import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const DISCORD_URL = 'https://discord.gg/2gZdMU7WWA';
const DISCORD_PURPLE = '#5865F2';
const DISCORD_PURPLE_PRESSED = '#4752C4';

const ctaPressProps = (enabled, base = DISCORD_PURPLE, pressed = DISCORD_PURPLE_PRESSED) => ({
  onTouchStart: (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(0.97)'; e.currentTarget.style.backgroundColor = pressed; } },
  onTouchEnd:   (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
  onMouseDown:  (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(0.97)'; e.currentTarget.style.backgroundColor = pressed; } },
  onMouseUp:    (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
  onMouseLeave: (e) => { if (enabled) { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.backgroundColor = base; } },
});

const DiscordLogo = ({ size = 72 }) => (
  <svg
    width={size}
    height={size * (96.36 / 127.14)}
    viewBox="0 0 127.14 96.36"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fill={DISCORD_PURPLE}
      d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
    />
  </svg>
);

const DiscordInvite = ({ onDone }) => {
  const [opening, setOpening] = useState(false);

  // Hide #root entirely while this screen is mounted, and render the screen
  // via a portal directly to <body>. Two reasons:
  //   1. #root has overflow-y:scroll globally — any fixed child of #root
  //      rubber-bands when #root bounces. Rendering as a body child takes us
  //      out of that scroll surface entirely.
  //   2. With #root display:none there is literally nothing else painted, so
  //      a pull gesture has no "background page" to reveal.
  // Also swallow touchmove as belt-and-suspenders.
  useEffect(() => {
    const root = document.getElementById('root');
    const prevDisplay = root?.style.display;
    if (root) root.style.display = 'none';

    const prevent = (e) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });

    return () => {
      if (root) root.style.display = prevDisplay || '';
      document.removeEventListener('touchmove', prevent);
    };
  }, []);

  const handleJoin = () => {
    if (opening) return;
    setOpening(true);
    try {
      window.open(DISCORD_URL, '_blank');
    } catch {}
    // Dismiss immediately — user returning from Discord shouldn't see the
    // invite again. Brief delay so the new tab/app handoff finishes cleanly.
    setTimeout(() => onDone(), 300);
  };

  const handleSkip = () => {
    if (opening) return;
    onDone();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden"
      style={{ overscrollBehavior: 'none', touchAction: 'manipulation' }}
    >
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="flex justify-center mb-8">
            <DiscordLogo size={72} />
          </div>

          <h2 className="text-[26px] font-bold mb-4 leading-tight">Build with us.</h2>

          <p className="text-gray-300 text-[15px] leading-relaxed mb-5">
            DaySeven is being built with its first users — and you're one of them.
          </p>

          <p className="text-gray-400 text-[14px] leading-relaxed mb-4">
            Inside the private Discord, you get to:
          </p>

          <ul className="text-left mx-auto max-w-[320px] mb-6 space-y-3">
            {[
              'Talk to me directly (founder)',
              'Request features and help shape what we build next',
              'Connect with other current and aspiring hybrid athletes',
            ].map((perk) => (
              <li key={perk} className="flex items-start gap-3">
                <span
                  className="mt-[7px] inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: DISCORD_PURPLE }}
                />
                <span className="text-[15px] text-gray-200 leading-snug">{perk}</span>
              </li>
            ))}
          </ul>

          <p className="text-gray-500 text-[13px] leading-relaxed">
            It's small on purpose.
          </p>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={handleJoin}
          disabled={opening}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{ backgroundColor: DISCORD_PURPLE, color: 'white', opacity: opening ? 0.7 : 1 }}
          {...ctaPressProps(!opening)}
        >
          Join Discord
        </button>
        <button
          onClick={handleSkip}
          disabled={opening}
          className="w-full mt-3 py-3 text-gray-400 text-sm font-medium"
          style={{ opacity: opening ? 0.4 : 1 }}
        >
          Maybe later
        </button>
      </div>
    </div>,
    document.body
  );
};

export default DiscordInvite;
