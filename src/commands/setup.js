const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ROLE_SLOTS, CHANNEL_SLOTS, setSlot, clearSlot, role, channel } = require('../lib/guildConfig');
const { guard } = require('../lib/permissions');
const { brand } = require('../lib/embeds');
const { config, reload } = require('../lib/config');
const { audit } = require('../lib/channelPerms');
const erlc = require('../lib/erlc');
const { vehicleMatches, liveryRestricted, staffLivery } = require('../lib/serverCheck');
const { parsePlayer } = require('../lib/erlc');
const { backfill, backfillAll, SOURCES } = require('../services/logReaders');
const nicknames = require('../services/nicknames');
const pings = require('../lib/pings');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// Read-only log sources may also be forums (one post per member / request) or a whole category.
const CHANNEL_TYPES = {
  ia_logs: [...TEXT_CHANNELS, ChannelType.GuildForum, ChannelType.GuildCategory],
  ban_requests: [...TEXT_CHANNELS, ChannelType.GuildForum],
};

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure LACRP Management (bot owner only). Re-run any time.')
  .addSubcommand((sub) => {
    sub.setName('roles').setDescription('Assign roles. Only the options you fill in are changed.');
    for (const [key, desc] of Object.entries(ROLE_SLOTS)) {
      sub.addRoleOption((o) => o.setName(key).setDescription(desc.slice(0, 100)));
    }
    return sub;
  })
  .addSubcommand((sub) => {
    sub.setName('channels').setDescription('Assign channels. Only the options you fill in are changed.');
    for (const [key, desc] of Object.entries(CHANNEL_SLOTS)) {
      sub.addChannelOption((o) => o.setName(key).setDescription(desc.slice(0, 100)).addChannelTypes(...(CHANNEL_TYPES[key] ?? TEXT_CHANNELS)));
    }
    return sub;
  })
  .addSubcommand((sub) => sub
    .setName('clear')
    .setDescription('Un-assign one role or channel slot.')
    .addStringOption((o) => o.setName('slot').setDescription('Slot to clear').setRequired(true).addChoices(
      ...Object.keys(ROLE_SLOTS).map((k) => ({ name: `role: ${k}`, value: `role:${k}` })),
      ...Object.keys(CHANNEL_SLOTS).map((k) => ({ name: `channel: ${k}`, value: `channel:${k}` })),
    )))
  .addSubcommand((sub) => sub.setName('view').setDescription('Show the current configuration and any missing channel permissions.'))
  .addSubcommand((sub) => sub.setName('reload').setDescription('Reload the files in /config (quota, vehicles, emojis, settings).'))
  .addSubcommand((sub) => sub.setName('rescan').setDescription('Re-read history from the Vex and Utility Bot log channels.'))
  .addSubcommand((sub) => sub.setName('vehicles').setDescription('List spawned vehicles + liveries exactly as ER:LC names them.'))
  .addSubcommand((sub) => sub.setName('pings').setDescription('Choose which roles a post pings (up to 3), or none.')
    .addStringOption((o) => o.setName('post').setDescription('Which post').setRequired(true)
      .addChoices(...Object.entries(pings.EVENTS).map(([value, e]) => ({ name: e.label, value }))))
    .addRoleOption((o) => o.setName('role1').setDescription('Role to ping'))
    .addRoleOption((o) => o.setName('role2').setDescription('Another role to ping'))
    .addRoleOption((o) => o.setName('role3').setDescription('Another role to ping'))
    .addBooleanOption((o) => o.setName('none').setDescription('Ping nobody for this post')))
  .addSubcommand((sub) => sub.setName('import-emojis').setDescription('Upload the server emojis listed in config/emoji-import.json.')
    .addBooleanOption((o) => o.setName('replace').setDescription('Delete + re-upload emojis that already exist with the same name (their IDs change)')))
  .addSubcommand((sub) => sub.setName('nicknames').setDescription('Set every member nickname to their Roblox username now (via Bloxlink).'));

function pingLines() {
  return Object.entries(pings.EVENTS).map(([key, e]) => {
    const roles = pings.rolesFor(key);
    return `**${e.label}** — ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : '*nobody*'}`;
  });
}

async function viewEmbed(guild) {
  const { embed, files } = brand({ guild });
  const perms = Object.fromEntries((await audit(guild).catch(() => [])).map((a) => [a.slot, a.missing]));
  const roleLines = Object.keys(ROLE_SLOTS).map((k) => `**${k}** — ${role(k) ? `<@&${role(k)}>` : '*not set*'}`);
  const chanLines = Object.keys(CHANNEL_SLOTS).map((k) => {
    if (!channel(k)) return `**${k}** — *not set*`;
    const missing = perms[k] ?? [];
    return `**${k}** — <#${channel(k)}> ${missing.length ? `⚠️ bot is missing: ${missing.join(', ')}` : '✅'}`;
  });
  embed.setTitle('⚙️ LACRP Management — Setup')
    .addFields(
      { name: 'Roles', value: roleLines.join('\n') },
      { name: 'Pings (/setup pings)', value: pingLines().join('\n') },
      { name: 'Channels', value: chanLines.join('\n').slice(0, 1024) },
    )
    .setFooter({ text: 'Change with /setup roles and /setup channels' });
  return { embeds: [embed], files, allowedMentions: { parse: [] } };
}

function vehicleReport(server) {
  const { restrictedVehicles = [], prohibitedVehicles = [], restrictedLiveries = [], liveryIgnoredTeams = [] } = config.vehicles;
  const teams = new Map((server.Players ?? []).map((p) => [parsePlayer(p.Player).name?.toLowerCase(), p.Team]));
  const lines = (server.Vehicles ?? []).map((v) => {
    const team = teams.get(String(v.Owner).toLowerCase());
    const hits = [];
    if (prohibitedVehicles.some((r) => vehicleMatches(r, v.Name))) hits.push('prohibited vehicle');
    else if (restrictedVehicles.some((r) => vehicleMatches(r, v.Name))) hits.push('restricted vehicle');
    if (liveryRestricted(v.Texture, team)) hits.push('restricted livery');
    if (staffLivery(v.Texture)) hits.push('staff-only livery');
    const flag = hits.length ? ` → ⚠️ ${hits.join(' + ')}` : '';
    return `• **${v.Name}** — livery: \`${v.Texture || '(none)'}\` — owner: ${v.Owner}${team ? ` (${team})` : ''}${flag}`;
  });
  const liveries = restrictedLiveries.map((l) => `\`${l}\``).join(', ') || 'nothing';
  return `**Spawned vehicles (${lines.length})**, named exactly as ER:LC reports them:\n` +
    `${lines.join('\n').slice(0, 1700) || 'None spawned.'}\n\n` +
    `Restricted liveries (exact name): ${liveries}, not checked for: ${liveryIgnoredTeams.join(', ') || 'no teams'} (config/vehicles.json). ` +
    'Premium/VIP drivers are skipped in /server-check.';
}

async function execute(interaction) {
  if (!(await guard(interaction, 'owner'))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'roles' || sub === 'channels') {
    const slots = sub === 'roles' ? ROLE_SLOTS : CHANNEL_SLOTS;
    const changed = [];
    for (const key of Object.keys(slots)) {
      const value = sub === 'roles' ? interaction.options.getRole(key) : interaction.options.getChannel(key);
      if (value) {
        setSlot(`${sub === 'roles' ? 'role' : 'channel'}:${key}`, value.id);
        changed.push(key);
      }
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const view = await viewEmbed(interaction.guild);
    if (!changed.length) return interaction.editReply({ content: 'Pick at least one option to set. Current setup:', ...view });
    await interaction.editReply({ content: `✅ Updated: ${changed.map((c) => `\`${c}\``).join(', ')}`, ...view });

    // Newly assigned read-only log channels get their history imported in the background.
    const toScan = changed.filter((c) => SOURCES.includes(c));
    if (toScan.length) {
      (async () => {
        const counts = [];
        for (const slot of toScan) counts.push(`${slot}: ${await backfill(interaction.client, slot)} messages`);
        await interaction.followUp({ content: `📥 History imported — ${counts.join(', ')}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      })();
    }
    return;
  }

  if (sub === 'clear') {
    const slot = interaction.options.getString('slot');
    clearSlot(slot);
    return interaction.reply({ content: `🗑️ Cleared \`${slot}\`.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'view') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await viewEmbed(interaction.guild));
  }

  if (sub === 'reload') {
    try {
      reload();
      return interaction.reply({ content: '🔄 Config files reloaded.', flags: MessageFlags.Ephemeral });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (sub === 'rescan') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const counts = await backfillAll(interaction.client);
    return interaction.editReply(`📥 Rescan complete — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  }

  if (sub === 'import-emojis') {
    const emojiImport = require('../services/emojiImport');
    if (emojiImport.isRunning()) return interaction.reply({ content: '⏳ An emoji import is already running - its result will be sent when it finishes.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let lastEdit = 0;
    const replace = interaction.options.getBoolean('replace') ?? false;
    let progress = '0/50';
    let toldDm = false;
    const lines = await emojiImport.job(interaction.guild, interaction.user.id, replace, {
      onProgress: (done, total) => {
        progress = `${done}/${total}`;
        if (Date.now() - lastEdit > 5000) {
          lastEdit = Date.now();
          interaction.editReply(`⏳ Uploading emojis… ${progress}`).catch(() => {});
        }
      },
      // Discord pauses emoji uploads after many in a short time - say exactly when it resumes.
      onRateLimit: (resumeAt) => {
        const text = `⏸️ Discord's emoji upload limit was reached (${progress} done). The bot continues automatically <t:${resumeAt}:R> (at <t:${resumeAt}:t>). The final list will be sent here, or by DM if this takes longer than 15 minutes.`;
        interaction.editReply(text).catch(() => {});
        if (!toldDm && resumeAt * 1000 - Date.now() > 10 * 60 * 1000) {
          toldDm = true;
          interaction.user.send(text.replace('sent here, or by DM if this takes longer than 15 minutes', 'sent to you in this DM')).catch(() => {});
        }
      },
    });
    // Ephemeral replies expire after 15 minutes; fall back to a DM if needed.
    const chunks = require('../lib/embeds').chunkLines(lines, 1900);
    try {
      await interaction.editReply(chunks[0]);
      for (const c of chunks.slice(1)) await interaction.followUp({ content: c, flags: MessageFlags.Ephemeral });
    } catch {
      for (const c of chunks) await interaction.user.send(c).catch(() => {});
    }
    return;
  }

  if (sub === 'pings') {
    const post = interaction.options.getString('post');
    const roles = ['role1', 'role2', 'role3'].map((k) => interaction.options.getRole(k)).filter(Boolean);
    if (interaction.options.getBoolean('none')) pings.setRoles(post, []);
    else if (roles.length) pings.setRoles(post, [...new Set(roles.map((r) => r.id))]);
    else return interaction.reply({ content: 'Pick at least one role, or set **none: True** to ping nobody.', flags: MessageFlags.Ephemeral });
    const current = pings.rolesFor(post);
    return interaction.reply({
      content: `🔔 **${pings.EVENTS[post].label}** will now ping: ${current.length ? current.map((id) => `<@&${id}>`).join(' ') : '*nobody*'}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'nicknames') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await nicknames.syncAll(interaction.guild, { force: true });
    return interaction.editReply(
      `✅ Nickname sync done.
` +
      `• Renamed: **${c.renamed}**
• Already correct: **${c.ok}**
• Not verified with Bloxlink: **${c.unlinked}**
` +
      `• Skipped (bots, server owner, Senior High Rank, ranked above the bot): **${c.exempt}**` +
      (c.unknown ? `
• Couldn't check (Bloxlink/Roblox unavailable or daily limit): **${c.unknown}**` : '') +
      (c.failed ? `
• Failed: **${c.failed}**` : ''),
    );
  }

  if (sub === 'vehicles') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      return interaction.editReply(vehicleReport(await erlc.getServer(['Players', 'Vehicles'])));
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }
  }
}

module.exports = { data, execute };
