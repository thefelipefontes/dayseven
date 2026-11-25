import { SHIELD_MIN_PERCENT } from '../utils/streakShield';
import { CARD_SURFACE, GOLD } from '../utils/designTokens';

// How a week counts — Win / Hold / Reset (utils/streakShield). Shown in the Streak Shield
// sheets on Home (ⓘ) and Profile (🛡️), and on onboarding's Streak Shield page, so all
// three explain the rule the same way. Nov 2026 redesign: the card surface, line icons
// (a gold flame, a white shield, a grey circle) and results in gold, white and grey.
const icon = (children, extra = {}) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...extra}>{children}</svg>
);
const TIERS = [
  {
    icon: icon(<path fill={GOLD} d="M12 2c.6 3 2.5 4.6 3.9 6.4 1.2 1.6 2.1 3.2 2.1 5.1A6 6 0 0 1 6 13.5c0-1.6.6-3 1.6-4.2.3 1.1 1.1 1.9 2.1 2.2C8.9 8.4 10.2 5 12 2z" />),
    title: 'Win · 100%', body: 'Every goal hit', result: 'Streak +1', color: GOLD,
  },
  {
    icon: icon(<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />, { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    title: `Hold · ${SHIELD_MIN_PERCENT}% overall`, body: 'Plus half of each goal', result: 'Streak stays', color: '#fff',
  },
  {
    icon: icon(<circle cx="12" cy="12" r="8" />, { width: 17, height: 17, fill: 'none', stroke: '#777', strokeWidth: 2 }),
    title: 'Below that', body: 'Or any goal under half', result: 'Resets', color: '#777', muted: true,
  },
];

const ShieldLadder = () => (
  <>
    <div className="mb-4" style={{ ...CARD_SURFACE, padding: '2px 16px' }}>
      {TIERS.map((t, i) => (
        <div
          key={t.title}
          className="flex items-center gap-3 py-3"
          style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.07)' : undefined }}
        >
          <span className="w-7 flex-shrink-0 flex items-center justify-center">{t.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: t.muted ? '#aaa' : '#fff' }}>{t.title}</p>
            <p className="text-xs text-gray-400">{t.body}</p>
          </div>
          <span className="ml-auto text-[12.5px] font-bold whitespace-nowrap" style={{ color: t.color }}>{t.result}</span>
        </div>
      ))}
    </div>
    <p className="text-xs text-gray-400 leading-relaxed mb-4">
      It works every week, on its own. A week that isn't going to be a win is still worth finishing strong.
    </p>
  </>
);

export default ShieldLadder;
