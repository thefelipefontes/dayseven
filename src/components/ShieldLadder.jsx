import { SHIELD_MIN_PERCENT } from '../utils/streakShield';

// How a week counts — Win / Hold / Reset (utils/streakShield). Shown in the Streak Shield
// sheets on Home (ⓘ) and Profile (🛡️) so both explain the rule the same way.
const TIERS = [
  { icon: '🔥', title: 'Win · 100%', body: 'Every goal hit', result: 'Streak +1', color: '#FFD700' },
  { icon: '🛡️', title: `Hold · ${SHIELD_MIN_PERCENT}% overall`, body: 'Plus half of each goal', result: 'Streak stays', color: '#e4e4e7' },
  { icon: '○', title: 'Below that', body: 'Or any goal under half', result: 'Resets', color: '#777', muted: true },
];

const ShieldLadder = () => (
  <>
    <div className="rounded-2xl overflow-hidden mb-4">
      {TIERS.map((t, i) => (
        <div
          key={t.title}
          className="flex items-center gap-3 px-3 py-2.5"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
        >
          <span className="w-7 flex-shrink-0 text-center text-base" style={{ opacity: t.muted ? 0.5 : 1 }}>{t.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: t.muted ? '#aaa' : '#fff' }}>{t.title}</p>
            <p className="text-xs text-gray-400">{t.body}</p>
          </div>
          <span className="ml-auto text-xs font-bold whitespace-nowrap" style={{ color: t.color }}>{t.result}</span>
        </div>
      ))}
    </div>
    <p className="text-xs text-gray-400 leading-relaxed mb-4">
      It works every week, on its own. A week that isn't going to be a win is still worth finishing strong.
    </p>
  </>
);

export default ShieldLadder;
