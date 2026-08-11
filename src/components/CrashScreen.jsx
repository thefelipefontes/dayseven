// Shown instead of a black screen when a render or effect throws past every local
// try/catch. Two crashes shipped this way before the boundary existed (a ReferenceError
// in the share-stats block, and a bad setter in FinishWorkoutModal): Sentry captured
// both, but React unmounted the whole tree and the user just got black with no way out.
//
// Reload rather than resetError — these errors are usually deterministic, so re-rendering
// the same tree crashes again; a reload re-runs auth and startup from scratch.
const CrashScreen = ({ eventId }) => (
  <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8 text-center">
    <div className="relative w-[60px] h-[60px] mb-6">
      <svg className="absolute top-0 left-0 w-[60px] h-[60px]" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="#333" strokeWidth="5" />
      </svg>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold text-white">7</span>
    </div>
    <h1 className="text-white text-lg font-bold mb-2">Something broke</h1>
    <p className="text-gray-400 text-sm mb-6 max-w-xs">
      Day Seven hit an unexpected error. Your data is safe — reloading usually clears it.
    </p>
    <button
      onClick={() => window.location.reload()}
      className="px-6 py-3 rounded-full font-bold text-black"
      style={{ backgroundColor: '#00FF94' }}
    >
      Reload
    </button>
    {eventId && (
      <p className="text-gray-600 text-[10px] mt-6 select-all">Error ID: {eventId}</p>
    )}
  </div>
);

export default CrashScreen;
