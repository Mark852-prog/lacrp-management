// The LAPD server layout: ranks, division roles, categories and channels.
// /setup makes the server match this file. Edit it to change the layout.

// Rank colours: royal blues, lighter further down the chain of command.
const COLORS = {
  shr: 0x1e3fae,
  hr: 0x2550c4,
  supervisor: 0x2d62d6,
  officer: 0x3a74e0,
  trainee: 0x6b95ea,
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

// A plain white line role that separates sections on a member's profile. It's long enough to sit on a row
// of its own on phones. Every separator has the same name, so /setup tells them apart by order; the label
// is only for reading this file.
const ROLE_LINE_NAME = '▬'.repeat(32);
const WHITE = 0xffffff;
const divider = (label) => ({ name: ROLE_LINE_NAME, line: true, label, color: WHITE, hoist: false });
// A section header role, e.g. "▬ [SV] Supervisory Personnel ▬▬▬▬▬▬▬▬▬▬▬▬▬▬".
const header = (tag, name) => ({ name: `▬ [${tag}] ${name} ${'▬'.repeat(14)}`, color: WHITE, hoist: false });
const group = (color, names) => names.map((name) => ({ name, color, hoist: false }));

const DIVISION_COLORS = {
  training: 0x3498db,
  ia: 0x27ae60,
  metro: 0x34495e,
  detective: 0xb7950b,
  traffic: 0x1abc9c,
  k9: 0xa0522d,
  air: 0x85c1e9,
  community: 0x8e44ad,
};

// Every role /setup manages, top to bottom.
const ROLES = [
  ...RANKS.map((r) => ({ name: r.name, color: COLORS[r.tier], hoist: true })),
  ...group(DIVISION_COLORS.training, DIVISIONS.training),
  ...group(DIVISION_COLORS.ia, DIVISIONS.ia),

  divider('Command Groups'),
  header('CS', 'Command Staff'),
  header('HC', 'High Command'),
  header('SV', 'Supervisory Personnel'),
  header('PO', 'Police Officers'),
  header('PR', 'Probationary Officers'),
  { name: 'Los Angeles Police Department', color: 0x2f6db5, hoist: false },

  divider('Divisions'),
  { name: 'Training Division', color: DIVISION_COLORS.training, hoist: false },
  { name: 'Internal Affairs Division', color: DIVISION_COLORS.ia, hoist: false },
  { name: 'Metropolitan Division', color: DIVISION_COLORS.metro, hoist: false },
  { name: 'Detective Bureau', color: DIVISION_COLORS.detective, hoist: false },
  { name: 'Traffic Division', color: DIVISION_COLORS.traffic, hoist: false },
  { name: 'K-9 Unit', color: DIVISION_COLORS.k9, hoist: false },
  { name: 'Air Support Division', color: DIVISION_COLORS.air, hoist: false },
  { name: 'Community Relations Office', color: DIVISION_COLORS.community, hoist: false },

  divider('Division Ranks'),
  ...group(DIVISION_COLORS.metro, ['Metro Commander', 'Metro Supervisor', 'SWAT Operator', 'SWAT Candidate']),
  ...group(DIVISION_COLORS.detective, ['Detective Supervisor', 'Detective', 'Detective Trainee']),
  ...group(DIVISION_COLORS.traffic, ['Traffic Supervisor', 'Motor Officer']),
  ...group(DIVISION_COLORS.k9, ['K-9 Handler']),
  ...group(DIVISION_COLORS.air, ['Air Unit Pilot']),

  divider('Department Duties'),
  ...group(0xd4a017, [
    'Field Training Officer',
    'Application Reviewer',
    'Warrant Approver',
    'Arrest Report Reviewer',
    'Callsign Manager',
    'Session Host',
    'Event Host',
  ]),

  divider('Certifications'),
  ...group(0x2e86c1, [
    'Rifle Certified',
    'Less-Lethal Certified',
    'Pursuit Certified',
    'Unmarked Vehicle Certified',
    'Motorcycle Certified',
  ]),

  divider('Awards'),
  ...group(0xf1c40f, [
    'Medal of Valor',
    'Police Star',
    'Distinguished Service Medal',
    'Meritorious Service Medal',
    'Life Saving Medal',
    'Officer of the Month',
  ]),

  divider('Time in Service'),
  { name: '1 Year of Service', color: 0xf1c40f, hoist: false },
  ...group(0x2742d8, ['6 Months of Service', '3 Months of Service', '1 Month of Service']),

  divider('Notifications'),
  ...group(0x5dade2, ['Session Ping', 'Announcement Ping', 'Training Ping', 'Event Ping', 'Poll Ping']),

  divider('Other'),
  { name: 'Department Applicant', color: 0xbdc3c7, hoist: false },
  { name: 'On Leave of Absence', color: 0xecf0f1, hoist: false },
  { name: 'Suspended', color: 0xc0392b, hoist: false },
  { name: 'Retired Officer', color: 0x7f8c8d, hoist: false },
  { name: 'Los Angeles Resident', color: 0x48c9b0, hoist: false },
  { name: 'Media Permissions', color: 0x9b59b6, hoist: false },
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

// Public categories use the framed name style ("︱📜︱department-rules"). `was` lists old names, so /setup
// renames those channels in place instead of making new ones.
const PUBLIC_CATEGORIES = [
  {
    name: '[LAPD] • Public Information', was: ['[LAPD] • Front Desk'], view: 'everyone', post: 'hr',
    channels: [
      text('🏛️', 'welcome'),
      text('📜', 'department-rules'),
      text('🧭', 'server-guide'),
      text('🔗', 'official-links', { was: ['useful-links'] }),
    ],
  },
  {
    name: '[LAPD] • Recruitment', view: 'everyone', post: 'hr',
    channels: [
      text('🚔', 'join-the-lapd'),
      text('📋', 'hiring-requirements'),
      text('📨', 'application-results', { was: ['application-status'] }),
    ],
  },
  {
    name: '[LAPD] • Headquarters', was: ['[LAPD] • Headquarters Bulletin'], view: 'everyone', post: 'hr',
    channels: [
      text('📢', 'announcements'),
      text('📡', 'session-status'),
      text('🛠️', 'server-updates'),
      text('📰', 'press-releases', { was: ['press-office'] }),
      LINE,
      text('🎖️', 'officer-of-the-month', { was: ['officer-spotlight'] }),
      text('🏅', 'wall-of-honor'),
      text('📷', 'media-gallery', { was: ['department-photos'] }),
    ],
  },
  {
    name: '[LAPD] • Public Services', view: 'everyone', post: 'hr',
    channels: [
      text('🎫', 'open-a-ticket'),
      text('📞', 'public-inquiries', { was: ['help-desk'], post: 'everyone' }),
      text('📝', 'suggestions', { was: ['ideas'], post: 'everyone' }),
    ],
  },
  {
    name: '[LAPD] • Community Relations', was: ['[LAPD] • Community Hub'], view: 'everyone', post: 'hr',
    channels: [
      text('📅', 'community-events'),
      text('🔔', 'notification-roles', { was: ['get-roles'] }),
    ],
  },
  {
    name: '[LAPD] • Public Lobby', was: ['[LAPD] • Public Lounge'], view: 'everyone', post: 'everyone',
    channels: [
      text('💬', 'general-chat', { was: ['community-chat'] }),
      text('⚙️', 'bot-commands', { was: ['bot-spam'] }),
      text('🎙️', 'tts-chat'),
      voice('🔊', 'Lobby Voice', { was: ['Public Voice'] }),
    ],
  },
].map((cat) => ({ ...cat, channels: cat.channels.map((ch) => ({ ...ch, framed: true })) }));

const CATEGORIES = [
  ...PUBLIC_CATEGORIES,
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
  {
    // Where the moderation and utility bots post. Only Command Staff can read it; bots post with Administrator.
    name: '[LAPD] • Server Logs', view: 'shr', post: 'nobody',
    channels: [
      text('🛡️', 'mod-logs'),
      text('💬', 'message-logs'),
      text('👥', 'member-logs'),
      text('🔐', 'security-logs'),
      text('🎫', 'ticket-transcripts'),
    ],
  },
];

// How names look in Discord: "📢︱announcements" for text, "🔊 | Briefing Room" for voice,
// and "︱📢︱announcements" / "| 🔊 | Lounge" in the public categories.
const LINE_NAME = '▬▬▬▬▬▬▬▬▬▬▬▬';
const channelName = (ch) => {
  if (ch.type === 'line') return LINE_NAME;
  if (ch.type === 'voice') return `${ch.framed ? '| ' : ''}${ch.emoji} | ${ch.name}`;
  return `${ch.framed ? '︱' : ''}${ch.emoji}︱${ch.name}`;
};

// Compares names without emoji, separators or case, so "📢 | announcements" matches "announcements".
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const isLine = (name) => /^[▬━─—\-_=]+$/.test(name);
// Separator roles are plain lines (section headers like "▬ [SV] ... ▬▬" have letters, so they don't count).
const isLineRole = (name) => isLine(name);

// Categories /setup looks after. Anything in one of these that isn't in the layout above is removed if it's empty.
const OWNED_CATEGORY = /^\[LAPD\] •/;

module.exports = { COLORS, RANKS, DIVISIONS, ROLES, ACCESS, CATEGORIES, channelName, normalize, isLine, isLineRole, OWNED_CATEGORY };
