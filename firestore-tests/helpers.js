// Shared fixtures for the rules tests. Payload shapes mirror what the app writes
// (src/services/*.js): the native plugin sends ISO strings, the web SDK serverTimestamp().
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const RULES = {
  transitional: path.join(__dirname, '..', 'firestore.rules'),
  strict: path.join(__dirname, '..', 'firestore.strict.rules'),
};

function emulatorHostPort() {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  return { host, port: Number(port) };
}

// One project per rule set, so the two can load side by side. Neither is the functions
// emulator's project, so no trigger runs on this data.
async function makeEnv(stage) {
  return initializeTestEnvironment({
    projectId: `demo-rules-${stage}`,
    firestore: { rules: fs.readFileSync(RULES[stage], 'utf8'), ...emulatorHostPort() },
  });
}

const iso = (msFromNow = 0) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 60 * 60 * 1000;

// The challenge createChallenge() writes for `targets` (1 = 1v1, 2+ = group).
function challengeDoc(challengerUid, targets, overrides = {}) {
  const isGroup = targets.length > 1;
  const now = Date.now();
  const id = `${challengerUid}_${isGroup ? 'group' : targets[0]}_${now}`;
  const deadline = iso(8 * HOUR); // one value for both, as createChallenge() does
  const participants = {};
  for (const uid of targets) participants[uid] = { status: 'pending' };
  const doc = {
    id,
    type: isGroup ? 'group' : '1v1',
    mode: 'all_complete',
    challengerUid,
    challengerName: 'Alice',
    title: 'Beat this',
    participantUids: [challengerUid, ...targets],
    participants,
    challengerActivity: {
      activityId: '1700000000000', type: 'Running', subtype: '', duration: 30,
      distance: 3.1, calories: 300, countToward: 'cardio', date: '2026-10-28',
    },
    matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 3.1 },
    windowHours: 24,
    requirePhoto: false,
    createdAt: iso(),
    expiresAt: deadline,
    respondByAt: deadline,
    status: 'pending',
  };
  if (!isGroup) {
    doc.friendUid = targets[0];
    doc.friendStatus = 'pending';
  }
  return { id, doc: { ...doc, ...overrides } };
}

module.exports = { makeEnv, challengeDoc, iso, HOUR };
