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

// Division ladders. They sit below the ranks, so a member's name colour always comes from their rank.
const DIVISIONS = {
  training: ['Head Instructor', 'Senior Instructor', 'Instructor', 'Junior Instructor', 'Trial Instructor'],
  ia: ['Head of Internal Affairs', 'Senior Internal Affairs', 'Internal Affairs', 'Junior Internal Affairs', 'Trial Internal Affairs'],
};

// A labelled line in the role list, e.g. "▬▬▬▬ Divisions ▬▬▬▬". Holds no permissions.
const divider = (label) => ({ name: `▬▬▬▬ ${label} ▬▬▬▬`, color: 0, hoist: false });
const group = (color, names) => names.map((name) => ({ name, color, hoist: false }));

// Every role /setup manages, top to bottom.
const ROLES = [
  ...RANKS.map((r) => ({ name: r.name, color: COLORS[r.tier], hoist: true })),

  divider('Command Groups'),
  ...group(0, [
    '[CS] Command Staff',
    '[HC] High Command',
    '[SV] Supervisory Personnel',
    '[PO] Police Officers',
    '[PR] Probationary Officers',
    'Los Angeles Police Department',
  ]),

  divider('Divisions'),
  { name: 'Training Division', color: 0x3e7cb1, hoist: false },
  { name: 'Internal Affairs Division', color: 0x5c6f91, hoist: false },
  { name: 'Metropolitan Division', color: 0x2f3b52, hoist: false },
  { name: 'Detective Bureau', color: 0x8c7a4a, hoist: false },
  { name: 'Traffic Division', color: 0x4f8a8b, hoist: false },
  { name: 'K-9 Unit', color: 0x7a5c3e, hoist: false },
  { name: 'Air Support Division', color: 0x6c8fb3, hoist: false },
  { name: 'Community Relations Office', color: 0x7f9cc9, hoist: false },

  divider('Division Ranks'),
  ...group(0x3e7cb1, DIVISIONS.training),
  ...group(0x5c6f91, DIVISIONS.ia),
  ...group(0x2f3b52, ['Metro Commander', 'Metro Supervisor', 'SWAT Operator', 'SWAT Candidate']),
  ...group(0x8c7a4a, ['Detective Supervisor', 'Detective', 'Detective Trainee']),
  ...group(0x4f8a8b, ['Traffic Supervisor', 'Motor Officer']),
  ...group(0x7a5c3e, ['K-9 Handler']),
  ...group(0x6c8fb3, ['Air Unit Pilot']),

  divider('Department Duties'),
  ...group(0x8a9bb8, [
    'Field Training Officer',
    'Application Reviewer',
    'Warrant Approver',
    'Arrest Report Reviewer',
    'Callsign Manager',
    'Session Host',
    'Event Host',
  ]),

  divider('Certifications'),
  ...group(0x4a7a8c, [
    'Rifle Certified',
    'Less-Lethal Certified',
    'Pursuit Certified',
    'Unmarked Vehicle Certified',
    'Motorcycle Certified',
  ]),

  divider('Awards'),
  ...group(0xc9a227, [
    'Medal of Valor',
    'Police Star',
    'Distinguished Service Medal',
    'Meritorious Service Medal',
    'Life Saving Medal',
    'Officer of the Month',
  ]),

  divider('Time in Service'),
  ...group(0x6b7a99, ['1 Year of Service', '6 Months of Service', '3 Months of Service', '1 Month of Service']),

  divider('Notifications'),
  ...group(0x99aab5, ['Session Ping', 'Announcement Ping', 'Training Ping', 'Event Ping', 'Poll Ping']),

  divider('Other'),
  { name: 'Department Applicant', color: 0x9aa5b1, hoist: false },
  { name: 'On Leave of Absence', color: 0x707a86, hoist: false },
  { name: 'Suspended', color: 0x8b3a3a, hoist: false },
  { name: 'Retired Officer', color: 0x5f6b7a, hoist: false },
  { name: 'Los Angeles Resident', color: 0x7a8b6f, hoist: false },
  { name: 'Media Permissions', color: 0, hoist: false },
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
      text('📮', 'file-a-complaint'),
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
      text('📚', 'ia-information', { post: 'iaLead' }),
      LINE,
      text('💬', 'ia-lounge'),
      text('⚙️', 'ia-commands'),
      LINE,
      text('🏆', 'ia-points', { post: 'iaLead' }),
      text('📥', 'complaint-intake'),
      text('🚫', 'discipline-requests'),
      text('📨', 'appeal-requests'),
      text('🔬', 'ia-evidence'),
      text('🗂️', 'ia-logs'),
      voice('🔊', 'Interview Room'),
    ],
  },
  {
    // Supervisors, High Command and Command Staff share one category; some channels are HR or SHR only.
    name: '[LAPD] • SV / HR / SHR', view: 'supervisors',
    channels: [
      text('📢', 'command-announcements', { post: 'shr' }),
      text('📚', 'command-information', { post: 'shr' }),
      text('📌', 'bulletin-board', { post: 'hr' }),
      LINE,
      text('💬', 'command-lounge'),
      text('💻', 'command-bot-commands'),
      text('🧯', 'department-issues'),
      text('🧪', 'embed-testing', { view: 'hr' }),
      LINE,
      text('🙋', 'personnel-requests'),
      text('🏖️', 'loa-requests'),
      text('📥', 'pending-applications', { view: 'hr' }),
      text('⛔', 'pending-discipline', { view: 'hr' }),
      text('🌟', 'officer-reviews'),
      LINE,
      text('🗃️', 'command-logs', { view: 'hr' }),
      text('🔎', 'audit-logs', { view: 'shr' }),
      text('🗃️', 'probation-logs', { view: 'hr' }),
      voice('🔊', 'Command Room'),
      voice('🔒', "Chief's Office", { view: 'shr' }),
    ],
  },
];

// How names look in Discord: "📢︱announcements" for text, "🔊 | Briefing Room" for voice.
const LINE_NAME = '▬▬▬▬▬▬▬▬▬▬▬▬';
const channelName = (ch) => {
  if (ch.type === 'line') return LINE_NAME;
  return ch.type === 'voice' ? `${ch.emoji} | ${ch.name}` : `${ch.emoji}︱${ch.name}`;
};

// Compares names without emoji, separators or case, so "📢 | announcements" matches "announcements".
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const isLine = (name) => /^[▬━─—\-_=]+$/.test(name);

// Categories /setup looks after. Anything in one of these that isn't in the layout above is removed if it's empty.
const OWNED_CATEGORY = /^\[LAPD\] •/;

module.exports = { COLORS, RANKS, DIVISIONS, ROLES, ACCESS, CATEGORIES, channelName, normalize, isLine, OWNED_CATEGORY };
