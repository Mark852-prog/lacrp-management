const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { forEdit } = require('../lib/embeds');
const { withPing } = require('../lib/pings');
const { sessionCard } = require('../lib/sessionUi');
const { postToSessions } = require('../lib/sessionPost');
const { run, get, all, now } = require('../lib/db');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

const data = new SlashCommandBuilder()
  .setName('session-poll')
  .setDescription('Ask the community when (or whether) they want the next session.')
  .addStringOption((o) => o.setName('option1').setDescription('First choice, e.g. "Tonight 7 PM"').setRequired(true).setMaxLength(80))
  .addStringOption((o) => o.setName('option2').setDescription('Second choice').setRequired(true).setMaxLength(80))
  .addStringOption((o) => o.setName('option3').setDescription('Third choice').setMaxLength(80))
  .addStringOption((o) => o.setName('option4').setDescription('Fourth choice').setMaxLength(80))
  .addStringOption((o) => o.setName('question').setDescription('Question (default: "When should the next session be?")').setMaxLength(200));

function pollMessage(poll) {
  const options = JSON.parse(poll.options);
  const counts = options.map(() => 0);
  for (const v of all('SELECT option FROM poll_votes WHERE message_id = ?', poll.message_id)) counts[v.option] += 1;
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(...counts);
  const leaders = counts.map((c, i) => (c === top && c > 0 ? i : -1)).filter((i) => i >= 0);

  const { top: banner, main, files } = sessionCard();
  main.setTitle(poll.closed ? '📊 Session Poll — Closed' : '📊 Session Poll')
    .setDescription(
      `**${poll.question}**\n` +
      (poll.closed
        ? (leaders.length ? `-# Final result: **${leaders.map((i) => options[i]).join(' / ')}** wins with ${top} vote${top === 1 ? '' : 's'}.` : '-# The poll closed with no votes.')
        : '-# Vote with the buttons below — one vote each, tap again to change or remove it.'),
    );
  options.forEach((opt, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    const lead = leaders.includes(i) ? ' ⭐' : '';
    main.addFields({ name: `${NUMBERS[i]} ${opt}${lead}`, value: `**${counts[i]}** vote${counts[i] === 1 ? '' : 's'} · ${pct}% of all votes` });
  });
  main.addFields({ name: '​', value: `**${total}** total vote${total === 1 ? '' : 's'} · started by <@${poll.created_by}>` });

  const row = new ActionRowBuilder().addComponents(
    ...options.map((o, i) => new ButtonBuilder().setCustomId(`poll:${i}`).setEmoji(NUMBERS[i]).setLabel(o.slice(0, 70))
      .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(poll.closed))),
    new ButtonBuilder().setCustomId('poll:close').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(Boolean(poll.closed)),
  );
  const staffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('poll:voters').setLabel('Voters').setEmoji('👥').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [banner, main], files, components: [row, staffRow], allowedMentions: { parse: [] } };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const options = ['option1', 'option2', 'option3', 'option4'].map((k) => interaction.options.getString(k)).filter(Boolean);
  const question = interaction.options.getString('question') ?? 'When should the next session be?';
  const draft = { message_id: 'draft', created_by: interaction.user.id, options: JSON.stringify(options), question, closed: 0 };
  const msg = await postToSessions(interaction, withPing(pollMessage(draft), 'session_poll'));
  if (!msg) return;
  run('INSERT INTO polls(message_id, kind, created_by, created_at, options, question) VALUES(?, ?, ?, ?, ?, ?)',
    msg.id, 'poll', interaction.user.id, now(), JSON.stringify(options), question);
  return interaction.editReply(`📊 Poll posted in ${msg.channel}.`);
}

// Who voted for what - shown privately to the poll's creator and Supervisor+.
function votersReply(interaction, poll) {
  if (interaction.user.id !== poll.created_by && !can(interaction.member, 'supervisor')) {
    return interaction.reply({ content: '🔒 Only the poll creator or a Supervisor+ can see who voted.', flags: MessageFlags.Ephemeral });
  }
  const options = JSON.parse(poll.options);
  const votes = all('SELECT user_id, option FROM poll_votes WHERE message_id = ?', poll.message_id);
  const lines = options.map((opt, i) => {
    const who = votes.filter((v) => v.option === i).map((v) => `<@${v.user_id}>`);
    return `${NUMBERS[i]} **${opt}** (${who.length})\n${who.length ? who.join(' ') : '-# nobody'}`;
  });
  return interaction.reply({ content: `👥 **Voters**: ${poll.question}\n\n${lines.join('\n\n')}`.slice(0, 2000), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function button(interaction) {
  const poll = get('SELECT * FROM polls WHERE message_id = ?', interaction.message.id);
  if (poll && interaction.customId === 'poll:voters') return votersReply(interaction, poll);
  if (!poll || poll.closed) return interaction.reply({ content: 'This poll is closed.', flags: MessageFlags.Ephemeral });
  const choice = interaction.customId.split(':')[1];

  if (choice === 'close') {
    if (interaction.user.id !== poll.created_by && !can(interaction.member, 'supervisor')) {
      return interaction.reply({ content: '🔒 Only the poll creator or a Supervisor+ can close it.', flags: MessageFlags.Ephemeral });
    }
    run('UPDATE polls SET closed = 1 WHERE message_id = ?', poll.message_id);
  } else {
    const option = Number(choice);
    const existing = get('SELECT option FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
    if (existing?.option === option) run('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
    else run('INSERT INTO poll_votes(message_id, user_id, option) VALUES(?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET option = excluded.option', poll.message_id, interaction.user.id, option);
  }
  return interaction.update(forEdit(pollMessage(get('SELECT * FROM polls WHERE message_id = ?', poll.message_id))));
}

// Redraw recent polls (adds new buttons/wording to polls posted before an update).
async function refreshRecent(client) {
  const { fetchChannel } = require('../lib/guildConfig');
  const ch = await fetchChannel(client, 'sessions').catch(() => null);
  if (!ch) return;
  for (const poll of all("SELECT * FROM polls WHERE kind = 'poll' AND created_at >= ?", now() - 30 * 86400)) {
    const msg = await ch.messages.fetch(poll.message_id).catch(() => null);
    if (msg) await msg.edit(forEdit(pollMessage(poll))).catch((err) => console.warn('[poll refresh]', err.message));
  }
}

module.exports = { data, execute, refreshRecent, buttons: { poll: button } };
