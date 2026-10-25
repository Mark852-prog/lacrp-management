// The LAPD server layout: ranks, division roles, categories and channels.
// /setup builds whatever in here is missing from the server. Edit this file to change the layout.

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

// Who can see (or post in) a category or channel. 'everyone' means the whole server.
const ACCESS = {
  everyone: null,
  department: ranksIn('shr', 'hr', 'supervisor', 'officer', 'trainee'),
  trainees: [...ranksIn('trainee', 'hr', 'shr'), ...DIVISIONS.training],
  training: [...DIVISIONS.training, ...ranksIn('hr', 'shr')],
  supervisors: ranksIn('supervisor', 'hr', 'shr'),
  ia: [...DIVISIONS.ia, ...ranksIn('shr')],
  hr: ranksIn('hr', 'shr'),
  shr: ranksIn('shr'),
};

// `view` = who sees it, `post` = who can talk in it (defaults to `view`). Channels inherit from their category.
const text = (emoji, name, opts = {}) => ({ type: 'text', emoji, name, ...opts });
const voice = (emoji, name, opts = {}) => ({ type: 'voice', emoji, name, ...opts });

const CATEGORIES = [
  {
    name: '[LAPD] • Front Desk', view: 'everyone', post: 'hr',
    channels: [
      text('👋', 'welcome'),
      text('📜', 'guidelines'),
      text('ℹ️', 'information'),
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
      text('🗒️', 'officer-feedback'),
      text('🤖', 'bot-commands'),
    ],
  },
  {
    name: '[LAPD] • Training Academy', view: 'trainees',
    channels: [
      text('📋', 'academy-information', { post: 'training' }),
      text('📅', 'training-schedule', { post: 'training' }),
      text('🚓', 'ride-along-requests'),
      text('✅', 'training-results', { post: 'training' }),
      text('💬', 'trainee-chat'),
      voice('🔊', 'Academy Classroom'),
    ],
  },
  {
    name: '[LAPD] • Training Division', view: 'training',
    channels: [
      text('📢', 'instructor-announcements', { post: 'hr' }),
      text('📚', 'training-materials'),
      text('📝', 'training-logs'),
      text('🗂️', 'trainee-evaluations'),
      text('💬', 'instructor-chat'),
      voice('🔊', 'Instructor Office'),
    ],
  },
  {
    name: '[LAPD] • Department', view: 'department',
    channels: [
      text('📢', 'department-announcements', { post: 'hr' }),
      text('📖', 'handbook', { post: 'hr' }),
      text('🚓', 'patrol-logs'),
      text('📸', 'patrol-media'),
      text('📅', 'leave-of-absence'),
      text('👋', 'resignation-requests'),
      text('💬', 'personnel-chat'),
      voice('🔊', 'Briefing Room'),
      voice('🚓', 'Patrol 1'),
      voice('🚓', 'Patrol 2'),
    ],
  },
  {
    name: '[LAPD] • Department Records', view: 'department', post: 'hr',
    channels: [
      text('📈', 'promotions'),
      text('🏅', 'commendations'),
      text('📉', 'infractions'),
      text('⛔', 'suspensions'),
      text('❌', 'terminations'),
    ],
  },
  {
    name: '[LAPD] • Supervisors', view: 'supervisors',
    channels: [
      text('📢', 'supervisor-announcements', { post: 'hr' }),
      text('💬', 'supervisor-chat'),
      text('📋', 'patrol-reviews'),
      text('⚠️', 'discipline-requests'),
      voice('🔊', 'Supervisor Office'),
    ],
  },
  {
    name: '[LAPD] • Internal Affairs', view: 'ia',
    channels: [
      text('📂', 'open-cases'),
      text('🗄️', 'closed-cases'),
      text('📝', 'investigation-notes'),
      text('💬', 'ia-chat'),
      voice('🔊', 'Interview Room'),
    ],
  },
  {
    name: '[LAPD] • High Command', view: 'hr',
    channels: [
      text('📢', 'command-announcements', { post: 'shr' }),
      text('💬', 'command-chat'),
      text('📈', 'promotion-requests'),
      text('📅', 'loa-approvals'),
      text('📋', 'department-logs'),
      voice('🔊', 'Command Room'),
    ],
  },
  {
    name: '[LAPD] • Senior High Command', view: 'shr',
    channels: [
      text('💬', 'shr-chat'),
      text('🗂️', 'department-planning'),
      text('🔐', 'audit-logs'),
      voice('🔊', "Chief's Office"),
    ],
  },
];

// How names look in Discord: "📢︱announcements" for text, "🔊 | Briefing Room" for voice.
const channelName = (ch) => (ch.type === 'voice' ? `${ch.emoji} | ${ch.name}` : `${ch.emoji}︱${ch.name}`);

// Compares names without emoji, separators or case, so "📢 | announcements" matches "announcements".
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = { COLORS, RANKS, DIVISIONS, ROLES, ACCESS, CATEGORIES, channelName, normalize };
