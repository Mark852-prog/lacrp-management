// IA case logs and ban-request reviews, both read from Utility Bot messages.
//
// IA logs ("Ban Appeal Logged", "Infraction Logged", ...): the @mention is the person the case is
// ABOUT. The IA member who handled it is whoever owns the log, found in this order:
//   1. the user who ran the Utility Bot command that posted it (Discord records this on the message)
//   2. the creator of the thread it's in (e.g. an IA member's forum post)
//   3. an IA member whose name appears in the channel/thread name (e.g. #ia-logs-ghost)
//
// Ban requests ("Ban Request Submission" panel + a thread per request): a review is credited to
//   1. whoever pressed Approve/Deny, when the Utility Bot answers the button with a message
//   2. a person named/mentioned next to "approved"/"denied" in the edited panel or a thread message
//   3. a human who starts a message in the request thread with "approved"/"denied"
const { run, get } = require('../lib/db');
const { role } = require('../lib/guildConfig');

const MENTION = /<@!?(\d{15,21})>/;
const COMPONENT_INTERACTION = 3; // InteractionType.MessageComponent

const text = (message) => {
  const e = message.embeds?.[0];
  return [message.content, e?.title, e?.description, ...(e?.fields ?? []).flatMap((f) => [f.name, f.value]), e?.footer?.text]
    .filter(Boolean).join('\n');
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const unix = (message) => Math.floor(message.createdTimestamp / 1000);

// Who ran the command / pressed the button that produced this bot message.
function actorOf(message) {
  const meta = message.interactionMetadata;
  return meta?.user?.id ?? message.interaction?.user?.id ?? null;
}

function memberNameIn(guild, haystack, roleSlot) {
  const h = norm(haystack);
  if (!guild || h.length < 3) return null;
  const roleId = role(roleSlot);
  const candidates = guild.members.cache.filter((m) => !m.user.bot && (!roleId || m.roles.cache.has(roleId)));
  let best = null;
  for (const m of candidates.values()) {
    for (const name of [m.user.username, m.user.globalName, m.displayName]) {
      const n = norm(name);
      if (n.length >= 3 && h.includes(n) && (!best || n.length > best.len)) best = { id: m.id, len: n.length };
    }
  }
  return best?.id ?? null;
}

// ---------- IA logs ----------
function parseIaLog(message) {
  const embed = message.embeds?.[0];
  const title = embed?.title ?? '';
  if (!/logged/i.test(title)) return false;
  const kind = title.replace(/logged/i, '').replace(/[^\w\s]/g, '').trim().toLowerCase() || 'case';
  const body = [embed.description, ...(embed.fields ?? []).map((f) => `${f.name} ${f.value}`)].filter(Boolean).join('\n');
  const subjectId = body.match(/(?:member|user)\W*<@!?(\d{15,21})>/i)?.[1] ?? body.match(MENTION)?.[1] ?? null;

  const ch = message.channel;
  const threadOwner = ch?.isThread?.() && ch.ownerId !== message.client?.user?.id ? ch.ownerId : null;
  const iaMember = actorOf(message)
    ?? (threadOwner && !message.guild?.members.cache.get(threadOwner)?.user.bot ? threadOwner : null)
    ?? memberNameIn(message.guild, ch?.name, 'internal_affairs')
    ?? memberNameIn(message.guild, ch?.parent?.isThread?.() ? ch.parent.name : null, 'internal_affairs');

  run(`INSERT INTO ia_logs(message_id, ia_member_id, kind, subject_id, ts) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET ia_member_id = COALESCE(excluded.ia_member_id, ia_member_id), kind = excluded.kind, subject_id = excluded.subject_id`,
  message.id, iaMember, kind, subjectId, unix(message));
  return true;
}

// ---------- ban requests ----------
function outcomeOf(str) {
  if (/\b(approv|accept)/i.test(str)) return 'approved';
  if (/\b(deni|deny|declin|reject)/i.test(str)) return 'denied';
  return null;
}

// Finds "... approved by <@id>" / "Denied by Name" style reviewers in text.
function reviewerIn(guild, str) {
  const m = str.match(/(?:approved|denied|accepted|declined|rejected|reviewed|handled)\s*(?:by)?[\s:*_-]*(?:<@!?(\d{15,21})>|([^\n*|•]{3,40}))/i);
  if (!m) return null;
  return m[1] ?? memberNameIn(guild, m[2], null);
}

function recordReview(panelId, outcome, reviewerId, ts) {
  if (!panelId || !outcome) return false;
  const existing = get('SELECT reviewer_id FROM ban_requests WHERE message_id = ?', panelId);
  if (!existing) run('INSERT OR IGNORE INTO ban_requests(message_id, submitted_at) VALUES(?, ?)', panelId, ts);
  run('UPDATE ban_requests SET outcome = ?, reviewer_id = COALESCE(?, reviewer_id), reviewed_at = COALESCE(reviewed_at, ?) WHERE message_id = ?',
    outcome, reviewerId, ts, panelId);
  return true;
}

function parseBanMessage(message) {
  const embed = message.embeds?.[0];
  const all = text(message);

  // The panel itself (new, or edited after a decision).
  if (embed && /ban request/i.test(embed.title ?? '')) {
    const field = (re) => (embed.fields ?? []).find((f) => re.test(f.name))?.value?.replace(/`/g, '').trim() ?? null;
    const requestedBy = (embed.footer?.text ?? '').match(/requested by\s*([^\n]+)/i)?.[1]?.replace(/\.$/, '').trim() ?? null;
    run(`INSERT INTO ban_requests(message_id, target, requested_by, submitted_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET target = excluded.target, requested_by = excluded.requested_by`,
    message.id, [field(/username/i), field(/user id/i)].filter(Boolean).join(' / ') || null, requestedBy, unix(message));
    // Only look at text outside the original request wording for a decision.
    const decision = [embed.title?.replace(/ban request submission/i, ''), embed.description?.replace(/assign the appropriate outcome/i, ''), ...(embed.fields ?? []).filter((f) => /status|outcome|decision|review/i.test(f.name)).map((f) => `${f.name} ${f.value}`), embed.footer?.text?.replace(/requested by[^\n]*/i, '')].filter(Boolean).join('\n');
    const outcome = outcomeOf(decision);
    if (outcome) recordReview(message.id, outcome, reviewerIn(message.guild, decision), Math.floor((message.editedTimestamp ?? message.createdTimestamp) / 1000));
    return true;
  }

  // Replies to the Approve/Deny buttons, or decisions typed in the request's thread.
  const outcome = outcomeOf(all);
  if (!outcome) return false;
  const ch = message.channel;
  // A thread started from the panel has the same ID as the panel message.
  const panelId = message.interactionMetadata?.interactedMessageId ?? message.reference?.messageId ?? (ch?.isThread?.() ? ch.id : null);
  if (!panelId) return false;

  let reviewer = null;
  if (message.author?.bot) {
    reviewer = (message.interactionMetadata?.type === COMPONENT_INTERACTION ? actorOf(message) : null) ?? reviewerIn(message.guild, all);
  } else if (/^\s*(approved|denied|accepted|declined)\b/i.test(message.content ?? '')) {
    reviewer = message.author.id;
  }
  if (!reviewer) return false;
  return recordReview(panelId, outcome, reviewer, unix(message));
}

module.exports = { parseIaLog, parseBanMessage, outcomeOf, reviewerIn };
