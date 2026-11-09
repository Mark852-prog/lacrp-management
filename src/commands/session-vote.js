const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { forEdit } = require('../lib/embeds');
const { rolesFor } = require('../lib/pings');
const { buildVotePost, buildVotersReply } = require('../lib/sessionUi');
const { postToSessions } = require('../lib/sessionPost');
const { fetchChannel } = require('../lib/guildConfig');
const { run, get, all, now } = require('../lib/db');

// Same tables as before (polls / poll_votes). poll_votes.option: 0 = yes, 1 = no.
// Votes cast before Yes/No existed have option 0, so they count as yes.
const YES = 0;
const NO = 1;

const data = new SlashCommandBuilder()
  .setName('session-vote')
  .setDescription('Start a vote to see if enough people will join a session.');

function voteState(messageId) {
  const rows = all('SELECT user_id, option FROM poll_votes WHERE message_id = ?', messageId);
  return {
    yesIds: rows.filter((r) => r.option !== NO).map((r) => r.user_id),
    noIds: rows.filter((r) => r.option === NO).map((r) => r.user_id),
  };
}

function voteMessage(poll) {
  const { yesIds, noIds } = voteState(poll.message_id);
  return buildVotePost({
    yes: yesIds.length,
    no: noIds.length,
    closed: Boolean(poll.closed),
    pingRoles: rolesFor('session_vote'),
  });
}

// Edits never re-ping, so mentions are switched off for them.
const forUpdate = (post) => ({ ...forEdit(post), allowedMentions: { parse: [] } });

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const msg = await postToSessions(interaction, voteMessage({ message_id: 'draft', closed: 0 }));
  if (!msg) return;
  run('INSERT INTO polls(message_id, kind, created_by, created_at) VALUES(?, ?, ?, ?)', msg.id, 'vote', interaction.user.id, now());
  return interaction.editReply(`Session vote posted in ${msg.channel}.`);
}

async function button(interaction) {
  const poll = get('SELECT * FROM polls WHERE message_id = ?', interaction.message.id);
  if (!poll) return interaction.reply({ content: 'This vote is no longer available.', flags: MessageFlags.Ephemeral });
  const action = interaction.customId.split(':')[1];

  // View Voters: anyone can open it; it is private to them.
  if (action === 'voters') {
    const { yesIds, noIds } = voteState(poll.message_id);
    return interaction.reply(buildVotersReply({ yesIds, noIds, viewerId: interaction.user.id }));
  }

  if (poll.closed) return interaction.reply({ content: 'This vote is closed.', flags: MessageFlags.Ephemeral });

  // vote:yes, vote:no. The old vote:toggle button (posts from before this update) counts as yes.
  const option = action === 'no' ? NO : YES;
  const existing = get('SELECT option FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  if (existing && existing.option === option) {
    run('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  } else {
    run('INSERT INTO poll_votes(message_id, user_id, option) VALUES(?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET option = excluded.option',
      poll.message_id, interaction.user.id, option);
  }

  // Posts from before the card layout can't be edited into it; the vote is still recorded.
  if (!interaction.message.flags.has(MessageFlags.IsComponentsV2)) {
    const { yesIds, noIds } = voteState(poll.message_id);
    return interaction.reply({ content: `Vote recorded. Yes: ${yesIds.length} · No: ${noIds.length}`, flags: MessageFlags.Ephemeral });
  }
  await interaction.update(forUpdate(voteMessage(poll))).catch(() => {});
}

// Called when a session starts: open votes are closed and their post is switched to the closed look.
async function closeOpenVotes(client) {
  const open = all("SELECT * FROM polls WHERE kind = 'vote' AND closed = 0");
  if (!open.length) return;
  run("UPDATE polls SET closed = 1 WHERE kind = 'vote' AND closed = 0");
  const channel = await fetchChannel(client, 'sessions').catch(() => null);
  if (!channel) return;
  for (const poll of open) {
    const msg = await channel.messages.fetch(poll.message_id).catch(() => null);
    if (msg?.flags.has(MessageFlags.IsComponentsV2)) {
      await msg.edit(forUpdate(voteMessage({ ...poll, closed: 1 }))).catch((err) => console.warn('[vote close]', err.message));
    }
  }
}

module.exports = { data, execute, closeOpenVotes, buttons: { vote: button } };
