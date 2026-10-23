// /player - everything the bot knows about one Roblox player: live in-game info, linked Discord,
// playtime, join history, Discord check status and moderation history.
const { SlashCommandBuilder } = require('discord.js');
const erlc = require('../lib/erlc');
const { brand, ts, formatDuration } = require('../lib/embeds');
const { guard } = require('../lib/permissions');
const { get, all, now } = require('../lib/db');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');

const MAX_STAY = 12 * 3600; // a join with no matching leave is capped at this

const data = new SlashCommandBuilder()
  .setName('player')
  .setDescription('Profile of a Roblox player: in-game status, Discord, playtime and history (staff).')
  .addStringOption((o) => o.setName('username').setDescription('Roblox username').setRequired(true).setAutocomplete(true));

async function autocomplete(interaction) {
  const typed = interaction.options.getFocused();
  const rows = all('SELECT name FROM players WHERE name LIKE ? ORDER BY last_seen DESC LIMIT 25', `${typed}%`);
  return interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
}

// Playtime from the stored join/leave logs since `since` (plus the current stay if in-game).
function playtime(id, since, online) {
  const rows = all('SELECT ts, is_join FROM join_logs WHERE roblox_id = ? AND ts >= ? ORDER BY ts', id, since);
  let total = 0;
  let joinedAt = null;
  for (const r of rows) {
    if (r.is_join) joinedAt = joinedAt ?? r.ts;
    else if (joinedAt) {
      total += Math.min(r.ts - joinedAt, MAX_STAY);
      joinedAt = null;
    }
  }
  if (joinedAt && online) total += Math.min(now() - joinedAt, MAX_STAY);
  return { total, visits: rows.filter((r) => r.is_join).length };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'staff'))) return;
  await interaction.deferReply();
  const query = interaction.options.getString('username').trim();

  let server = null;
  try {
    server = await erlc.getServerCached(['Players', 'Vehicles'], 30_000);
  } catch { /* still show stored data */ }
  const live = (server?.Players ?? []).map((p) => ({ ...p, ...erlc.parsePlayer(p.Player) }))
    .find((p) => p.name?.toLowerCase() === query.toLowerCase());
  const known = live ? { roblox_id: live.id, name: live.name } : get('SELECT * FROM players WHERE name = ? COLLATE NOCASE', query);
  if (!known) return interaction.editReply(`❓ No player named **${query}** has been seen on the server. Usernames must be exact.`);

  const id = known.roblox_id;
  const name = known.name;
  const record = get('SELECT * FROM players WHERE roblox_id = ?', id);
  const discordId = await robloxToDiscord(id).catch(() => UNKNOWN);
  const member = discordId && discordId !== UNKNOWN ? await interaction.guild.members.fetch(discordId).catch(() => null) : null;
  const dc = get('SELECT status, checked_by, checked_at FROM dc_status WHERE roblox_id = ?', id);
  const week = playtime(id, now() - 7 * 86400, Boolean(live));
  const month = playtime(id, now() - 30 * 86400, Boolean(live));
  const days = get('SELECT COUNT(*) AS n FROM player_days WHERE roblox_id = ?', id).n;
  const mods = all(
    `SELECT player, command, ts FROM command_logs
     WHERE (command LIKE ? OR command LIKE ? OR command LIKE ? OR command LIKE ? OR command LIKE ? OR command LIKE ?)
     ORDER BY ts DESC LIMIT 6`,
    `:kick ${name}%`, `:ban ${name}%`, `:tban ${name}%`, `:kick ${id}%`, `:ban ${id}%`, `:tban ${id}%`,
  );

  const { embed, files } = brand({ guild: interaction.guild, withBanner: false });
  embed.setTitle(`👤 ${name}`)
    .setURL(`https://www.roblox.com/users/${id}/profile`)
    .setDescription(live ? '🟢 **In-game right now**' : `⚫ Offline${record ? ` · last seen ${ts(record.last_seen, 'R')}` : ''}`);

  if (live) {
    const car = (server.Vehicles ?? []).find((v) => String(v.Owner).toLowerCase() === name.toLowerCase());
    const where = live.Location?.StreetName ? `${live.Location.StreetName}${live.Location.PostalCode ? ` (postal ${live.Location.PostalCode})` : ''}` : null;
    embed.addFields(
      { name: 'Team', value: live.Team ?? '—', inline: true },
      { name: 'Callsign', value: live.Callsign ?? '—', inline: true },
      { name: 'Permission', value: live.Permission ?? 'Normal', inline: true },
      { name: 'Vehicle', value: car ? `${car.Name}${car.Texture ? ` · ${car.Texture}` : ''}${car.Plate ? ` · \`${car.Plate}\`` : ''}` : 'On foot', inline: true },
      { name: 'Location', value: where ?? 'Unknown', inline: true },
      { name: 'Wanted', value: live.WantedStars ? '⭐'.repeat(live.WantedStars) : 'No', inline: true },
    );
  }

  const discord = discordId === UNKNOWN ? 'Couldn\'t check (Bloxlink unavailable)'
    : member ? `<@${member.id}> · in the server` : discordId ? `<@${discordId}> · **not in the server**` : 'Not linked with Bloxlink';
  const dcText = dc ? `${dc.status === 'confirmed' ? '✅ Joined' : '❌ Not joined'} · by ${dc.checked_by} ${ts(dc.checked_at, 'R')}` : 'Not checked';
  embed.addFields(
    { name: 'Discord', value: discord, inline: true },
    { name: 'Discord check', value: dcText, inline: true },
    { name: 'Roblox ID', value: `\`${id}\``, inline: true },
    { name: 'Playtime (7 days)', value: `**${formatDuration(week.total)}** · ${week.visits} visit${week.visits === 1 ? '' : 's'}`, inline: true },
    { name: 'Playtime (30 days)', value: `**${formatDuration(month.total)}** · ${month.visits} visit${month.visits === 1 ? '' : 's'}`, inline: true },
    { name: 'Days seen', value: `**${days}**${record ? ` · first ${ts(record.first_seen, 'D')}` : ''}`, inline: true },
    {
      name: `Moderation (${mods.length})`,
      value: mods.length ? mods.map((m) => `\`${m.command.slice(0, 80)}\` · ${m.player} ${ts(m.ts, 'R')}`).join('\n').slice(0, 1024) : 'Nothing on record',
    },
  );
  return interaction.editReply({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

module.exports = { data, execute, autocomplete };
