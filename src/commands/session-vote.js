const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { guard } = require('../lib/permissions');
const { forEdit, SESSION_PINGS_BUTTON_ID } = require('../lib/embeds');
const { withPing } = require('../lib/pings');
const { sessionCard } = require('../lib/sessionUi');
const { postToSessions } = require('../lib/sessionPost');
const { config } = require('../lib/config');
const { run, get, all, now } = require('../lib/db');

const data = new SlashCommandBuilder()
  .setName('session-vote')
  .setDescription('Start a vote to see if enough people will join a session.')
  .addIntegerOption((o) => o.setName('votes').setDescription('Votes needed to start (default from settings)').setMinValue(1).setMaxValue(100));

function voteMessage(poll) {
  const voters = all('SELECT user_id FROM poll_votes WHERE message_id = ?', poll.message_id).map((r) => r.user_id);
  const reached = voters.length >= poll.needed;
  const { top, main, files } = sessionCard();
  main.setTitle(reached ? '🎉 Session Vote Passed' : '🗳️ Session Vote')
    .setDescription(reached
      ? '**The vote has passed!** A session will be starting shortly — get ready to join.'
      : '**Want a session?** Tap **Vote** if you\'ll join in-game.\nOnce enough people vote, a session will be started!')
    .addFields(
      { name: 'Progress', value: `**${voters.length}/${poll.needed}** votes · ${reached ? '**target reached**' : `**${poll.needed - voters.length}** more needed to start`}` },
      { name: `Voters (${voters.length})`, value: voters.length ? voters.map((v) => `<@${v}>`).join(' ').slice(0, 1024) : '-# No votes yet — be the first!' },
    )
    .setFooter({ text: `${config.settings.serverName} · Tap Vote again to remove your vote` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vote:toggle').setLabel(reached ? 'Vote passed' : 'Vote').setEmoji('✅')
      .setStyle(ButtonStyle.Success).setDisabled(Boolean(poll.closed)),
    new ButtonBuilder().setCustomId(SESSION_PINGS_BUTTON_ID).setLabel('Get Session Notification!').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [top, main], files, components: [row], allowedMentions: { parse: [] } };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const needed = interaction.options.getInteger('votes') ?? config.settings.sessionVoteDefaultVotes;
  const msg = await postToSessions(interaction, withPing(voteMessage({ message_id: 'draft', created_by: interaction.user.id, needed, closed: 0 }), 'session_vote'));
  if (!msg) return;
  run('INSERT INTO polls(message_id, kind, created_by, created_at, needed) VALUES(?, ?, ?, ?, ?)', msg.id, 'vote', interaction.user.id, now(), needed);
  return interaction.editReply(`🗳️ Session vote posted in ${msg.channel} (${needed} votes needed).`);
}

async function button(interaction) {
  const poll = get('SELECT * FROM polls WHERE message_id = ?', interaction.message.id);
  if (!poll || poll.closed) return interaction.reply({ content: 'This vote is closed.', flags: MessageFlags.Ephemeral });

  const had = get('SELECT 1 FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  if (had) run('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  else run('INSERT INTO poll_votes(message_id, user_id) VALUES(?, ?)', poll.message_id, interaction.user.id);

  const count = get('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = ?', poll.message_id).n;
  if (count >= poll.needed) run('UPDATE polls SET closed = 1 WHERE message_id = ?', poll.message_id);
  const updated = get('SELECT * FROM polls WHERE message_id = ?', poll.message_id);

  await interaction.update(forEdit(voteMessage(updated))).catch(() => {});
  if (updated.closed) {
    await interaction.followUp({ content: `🎉 <@${poll.created_by}> the session vote reached **${count}/${poll.needed}** — you're good to \`/session-start\`!` });
  }
}

module.exports = { data, execute, buttons: { vote: button } };
