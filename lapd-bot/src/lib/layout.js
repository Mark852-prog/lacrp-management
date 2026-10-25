// The LAPD server layout: ranks, division roles, categories and channels.
// /setup makes the server match this file. Edit it to change the layout.

const COLORS = {
  shr: 0x22408c,
  hr: 0x2b4e9e,
  supervisor: 0x355dae,
  officer: 0x4169b8,
  trainee: 0x5a7fc4,
  training: 0x3e7cb1,
  ia: 0x5c6f91,
};

// Chain of command, highest first. `tier` decides which channels a rank can see.
const RANKS = [
  { name: 'Chief of Police', tier: 'shr' },
  { name: 'Assistant Chief', tier: 'shr' },
  { name: 'Deputy Chief', tier: 'shr' },
  { name: 'Commander', tier: 'shr' },
  { name: 'Captain III', tier: 'hr' },
  { name: 'Captain II', tier: 'hr' },
  { name: 'Captain I', tier: 'hr' },
  { name: 'Lieutenant II', tier: 'hr' },
  { name: 'Lieutenant I', tier: 'hr' },
  { name: 'Sergeant II', tier: 'supervisor' },
  { name: 'Sergeant I', tier: 'supervisor' },
  { name: 'Senior Lead Officer', tier: 'officer' },
  { name: 'Police Officer III', tier: 'officer' },
  { name: 'Police Officer II', tier: 'officer' },
  { name: 'Police Officer I', tier: 'officer' },
  { name: 'Probationary Officer', tier: 'trainee' },
];

// Division roles sit below the ranks, so a member's name colour always comes from their rank.
const DIVISIONS = {
  training: ['Head Instructor', 'Senior Instructor', 'Instructor', 'Junior Instructor', 'Trial Instructor'],
  ia: ['Head of Internal Affairs', 'Senior Internal Affairs', 'Internal Affairs', 'Junior Internal Affairs', 'Trial Internal Affairs'],
};

const ROLES = [
  ...RANKS.map((r) => ({ name: r.name, color: COLORS[r.tier], hoist: true })),
  ...DIVISIONS.training.map((name) => ({ name, color: COLORS.training, hoist: false })),
  ...DIVISIONS.ia.map((name) => ({ name, color: COLORS.ia, hoist: false })),
];

const ranksIn = (...tiers) => RANKS.filter((r) => tiers.includes(r.tier)).map((r) => r.name);

// Who can see (or post in) a category or channel. 'everyone' means the whole server, 'nobody' locks posting.
const ACCESS = {
  everyone: null,
  nobody: [],
  department: ranksIn('shr', 'hr', 'supervisor', 'officer', 'trainee'),
  trainees: [...ranksIn('trainee', 'hr', 'shr'), ...DIVISIONS.training],
  training: [...DIVISIONS.training, ...ranksIn('hr', 'shr')],
  trainingLead: [...DIVISIONS.training.slice(0, 2), ...ranksIn('hr', 'shr')],
  supervisors: ranksIn('supervisor', 'hr', 'shr'),
  ia: [...DIVISIONS.ia, ...ranksIn('shr')],
  iaLead: [...DIVISIONS.ia.slice(0, 2), ...ranksIn('shr')],
  hr: ranksIn('hr', 'shr'),
  shr: ranksIn('shr'),
};

// `view` = who sees it, `post` = who can talk in it. Both default to the category's.
const text = (emoji, name, opts = {}) => ({ type: 'text', emoji, name, ...opts });
const voice = (emoji, name, opts = {}) => ({ type: 'voice', emoji, name, ...opts });
const LINE = { type: 'line' }; // a locked divider channel between groups

const CATEGORIES = [
  {
    name: '[LAPD] • Front Desk', view: 'everyone', post: 'hr',
    channels: [
      text('👋', 'welcome'),
      text('📜', 'guidelines'),
      text('ℹ️', 'information'),
      LINE,
      text('📢', 'announcements'),
      text('📰', 'press-releases'),
    ],
  },
  {
    name: '[LAPD] • Public Services', view: 'everyone', post: 'everyone',
    channels: [
      text('📝', 'applications', { post: 'hr' }),
      text('🎫', 'support'),
      text('❓', 'questions'),
      LINE,
      text('🗒️', 'officer-feedback'),
      text('🤖', 'bot-commands'),
    ],
  },
  {
    name: '[LAPD] • Community', view: 'everyone', post: 'everyone',
    channels: [
      text('💬', 'community-chat'),
      text('📷', 'community-media'),
      text('🎉', 'community', { post: 'hr' }),
      LINE,
      text('⭐', 'hall-of-fame', { post: 'hr' }),
      voice('🔊', 'Community Voice Chat'),
    ],
  },
  {
    name: '[LAPD] • Training Academy', view: 'trainees',
    channels: [
      text('📋', 'academy-information', { post: 'training' }),
      text('📢', 'academy-announcements', { post: 'training' }),
      LINE,
      text('📝', 'training-requests'),
      text('🎓', 'trainings', { post: 'training' }),
      text('✅', 'training-results', { post: 'training' }),
      LINE,
      text('🚓', 'ride-along-requests'),
      text('🚔', 'ride-alongs', { post: 'training' }),
      text('📊', 'ride-along-results', { post: 'training' }),
      LINE,
      text('💬', 'trainee-chat'),
      voice('🔊', 'Academy Classroom'),
    ],
  },
  {
    name: '[LAPD] • Training Division', view: 'training',
    channels: [
      text('📢', 'instructor-announcements', { post: 'trainingLead' }),
      text('ℹ️', 'instructor-information', { post: 'trainingLead' }),
      text('📖', 'instructor-handbook', { post: 'trainingLead' }),
      LINE,
      text('🎯', 'instructor-point-requests'),
      text('🏆', 'instructor-points-leaderboard', { post: 'trainingLead' }),
      LINE,
      text('📈', 'instructor-promotions', { post: 'trainingLead' }),
      text('📉', 'instructor-infractions', { post: 'trainingLead' }),
      LINE,
      text('💬', 'instructor-chat'),
      voice('🔊', 'Instructor Office'),
    ],
  },
  {
    name: '[LAPD] • Department Information', view: 'department', post: 'hr',
    channels: [
      text('📢', 'lapd-announcements'),
      text('📌', 'session-announcements', { post: 'supervisors' }),
      LINE,
      text('ℹ️', 'lapd-information'),
      text('📚', 'policies-and-procedures'),
    ],
  },
  {
    name: '[LAPD] • Department Requests', view: 'department',
    channels: [
      text('📻', 'callsign-requests'),
      text('📝', 'warrant-requests'),
      LINE,
      text('📅', 'leave-of-absence'),
      text('👋', 'resignation-requests'),
    ],
  },
  {
    name: '[LAPD] • Department Communications', view: 'department',
    channels: [
      text('💬', 'lapd-chat'),
      text('🚨', 'lapd-duty-chat'),
      text('📸', 'patrol-media'),
      text('🤖', 'lapd-commands'),
      LINE,
      text('🛡️', 'supervisor-chat', { view: 'supervisors' }),
    ],
  },
  {
    name: '[LAPD] • Department Records', view: 'department', post: 'hr',
    channels: [
      text('📈', 'promotions'),
      text('🏅', 'commendations'),
      LINE,
      text('📉', 'infractions'),
      text('⛔', 'suspensions'),
      text('❌', 'terminations'),
    ],
  },
  {
    name: '[LAPD] • Voice Channels', view: 'department',
    channels: [
      voice('🔊', 'Briefing Room'),
      voice('🚓', 'Patrol 1'),
      voice('🚓', 'Patrol 2'),
      voice('🛡️', 'Supervisor Office', { view: 'supervisors' }),
    ],
  },
  {
    name: '[LAPD] • Internal Affairs', view: 'ia',
    channels: [
      text('📢', 'ia-announcements', { post: 'iaLead' }),
      text('ℹ️', 'ia-information', { post: 'iaLead' }),
      text('📖', 'ia-handbook', { post: 'iaLead' }),
      LINE,
      text('📥', 'case-requests'),
      text('📂', 'open-cases'),
      text('🗄️', 'closed-cases'),
      LINE,
      text('📈', 'ia-promotions', { post: 'iaLead' }),
      text('📉', 'ia-infractions', { post: 'iaLead' }),
      LINE,
      text('💬', 'ia-chat'),
      voice('🔊', 'Interview Room'),
    ],
  },
  {
    name: '[LAPD] • High Command', view: 'hr',
    channels: [
      text('📢', 'command-announcements', { post: 'shr' }),
      text('ℹ️', 'command-information', { post: 'shr' }),
      LINE,
      text('📈', 'promotion-requests'),
      text('📝', 'infraction-requests'),
      text('📅', 'loa-requests'),
      LINE,
      text('💬', 'command-chat'),
      text('📋', 'department-logs'),
      LINE,
      text('🔒', 'shr-chat', { view: 'shr' }),
      text('🗂️', 'department-planning', { view: 'shr' }),
      voice('🔊', 'Command Room'),
      voice('🔒', "Chief's Office", { view: 'shr' }),
    ],
  },
];

// How names look in Discord: "📢︱announcements" for text, "🔊 | Briefing Room" for voice.
const LINE_NAME = '━━━━━━━━━━━━━━━━━━━━';
const channelName = (ch) => {
  if (ch.type === 'line') return LINE_NAME;
  return ch.type === 'voice' ? `${ch.emoji} | ${ch.name}` : `${ch.emoji}︱${ch.name}`;
};

// Compares names without emoji, separators or case, so "📢 | announcements" matches "announcements".
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const isLine = (name) => /^[━─—\-_=]+$/.test(name);

// Categories /setup looks after. Anything in one of these that isn't in the layout above is removed if it's empty.
const OWNED_CATEGORY = /^\[LAPD\] •/;

module.exports = { COLORS, RANKS, DIVISIONS, ROLES, ACCESS, CATEGORIES, channelName, normalize, isLine, OWNED_CATEGORY };
