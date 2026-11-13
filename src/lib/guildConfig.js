// Role/channel assignments made through /setup. Nothing here is hardcoded - every ID comes from the DB.
const { run, get, all } = require('./db');

const ROLE_SLOTS = {
  staff: 'Base staff role (everyone on the staff team)',
  supervisor: 'Supervisor (lowest rank that can approve requests / run sessions)',
  high_rank: 'High Rank',
  senior_high_rank: 'Senior High Rank',
  trial_moderator: 'Trial Moderator',
  trial_administrator: 'Trial Administrator',
  internal_affairs: 'Internal Affairs (IA team - separate 2h in-game quota)',
  session_pings: 'Session Pings (toggled by the "Get Session Notification!" button)',
  loa: 'Leave of Absence (excused from quota)',
  premium: 'Premium members (allowed restricted vehicles/liveries)',
  vip: 'VIP members (allowed restricted vehicles/liveries)',
  verified: 'Bloxlink verified role (getting it triggers the Roblox-username nickname)',
  in_game: 'In-Game (given while someone is in the ER:LC server)',
};

const CHANNEL_SLOTS = {
  staff_requests: 'Staff request queue',
  sessions: 'Session announcements (start/end/schedule/poll/vote/alerts)',
  dc_logs: 'DC (Discord check) log',
  vex_shift_logs: 'Vex shift logs (read-only - where Vex posts Shift Ended)',
  infractions: 'Utility Bot infractions (read-only)',
  promotions: 'Utility Bot promotions (read-only)',
  resignations: 'Utility Bot resignations (read-only)',
  ia_logs: "IA logs - channel, forum or category holding each IA member's logs (read-only)",
  ban_requests: 'Ban requests channel - panels + review threads (read-only)',
};

function getSlot(slot) {
  return get('SELECT value FROM guild_config WHERE key = ?', slot)?.value ?? null;
}
function setSlot(slot, id) {
  run('INSERT INTO guild_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', slot, id);
}
function clearSlot(slot) {
  run('DELETE FROM guild_config WHERE key = ?', slot);
}
function allSlots() {
  return Object.fromEntries(all('SELECT key, value FROM guild_config').map((r) => [r.key, r.value]));
}

const role = (slot) => getSlot(`role:${slot}`);
const channel = (slot) => getSlot(`channel:${slot}`);

async function fetchChannel(client, slot) {
  const id = channel(slot);
  if (!id) return null;
  try {
    return await client.channels.fetch(id);
  } catch {
    return null;
  }
}

module.exports = { ROLE_SLOTS, CHANNEL_SLOTS, getSlot, setSlot, clearSlot, allSlots, role, channel, fetchChannel };
