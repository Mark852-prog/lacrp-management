// /server-layout - bot owner only. The same jobs as data/layout-job.json, run from Discord:
//   backup  - backup + audit, sent back as files (changes nothing)
//   apply   - preview a plan file (channel order, role permissions/order, channel overwrites), apply on Confirm
//   restore - preview what differs from a backup file, put it back on Confirm
// Every Confirm takes a fresh backup first and returns it with the result.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { guard, isOwner } = require('../lib/permissions');
const layout = require('../services/serverLayout');

const PENDING_MINUTES = 15;
const pending = new Map(); // token -> { userId, kind, data, expires }

const data = new SlashCommandBuilder()
  .setName('server-layout')
  .setDescription('Backup, audit and approved changes to channels, roles and permissions (bot owner only).')
  .addSubcommand((s) => s.setName('backup').setDescription('Back up every channel, role and permission, plus the bot audit. Changes nothing.'))
  .addSubcommand((s) => s.setName('apply').setDescription('Preview a change plan (JSON file); nothing changes until you press Confirm.')
    .addAttachmentOption((o) => o.setName('plan').setDescription('The plan .json').setRequired(true)))
  .addSubcommand((s) => s.setName('restore').setDescription('Preview putting the server back to a backup; nothing changes until you press Confirm.')
    .addAttachmentOption((o) => o.setName('backup').setDescription('A server-backup-<time>.json').setRequired(true))
    .addStringOption((o) => o.setName('parts').setDescription('What to restore (default: everything)').addChoices(
      { name: 'Everything', value: 'order,overwrites,roles' },
      { name: 'Channel order only', value: 'order' },
      { name: 'Channel permission overwrites only', value: 'overwrites' },
      { name: 'Role permissions and order only', value: 'roles' },
    )));

const DATA = path.join(__dirname, '..', '..', 'data');
const file = (name, text) => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name });
const short = (lines) => {
  const text = lines.join('\n');
  return text.length > 1700 ? `${text.slice(0, 1700)}\n… (full list in the attached file)` : text;
};

async function load(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetch();
}

async function readJson(attachment) {
  if (!attachment.name.endsWith('.json') || attachment.size > 5_000_000) throw new Error('Attach a .json file (max 5 MB).');
  const res = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Couldn't download the file (${res.status}).`);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new Error('That file isn\'t valid JSON.');
  }
}

async function preview(interaction, kind, data) {
  const guild = interaction.guild;
  if (kind === 'restore') return layout.restore(guild, data.saved, { apply: false, parts: data.parts });
  const lines = [];
  if (data.order) lines.push('=== CHANNEL ORDER ===', ...(await layout.applyOrder(guild, data.order, { dryRun: true })), '');
  if (data.ops) lines.push('=== ROLES AND PERMISSIONS ===', ...(await layout.applyOps(guild, data.ops, { dryRun: true })));
  if (!lines.length) lines.push('The plan has no "order" or "ops" section - nothing to do.');
  return lines;
}

async function run(guild, kind, data) {
  if (kind === 'restore') return layout.restore(guild, data.saved, { apply: true, parts: data.parts });
  const lines = [];
  if (data.order) lines.push('=== CHANNEL ORDER ===', ...(await layout.applyOrder(guild, data.order)), '');
  if (data.ops) lines.push('=== ROLES AND PERMISSIONS ===', ...(await layout.applyOps(guild, data.ops)));
  return lines;
}

async function execute(interaction) {
  if (!(await guard(interaction, 'owner'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  await load(guild);
  const sub = interaction.options.getSubcommand();

  if (sub === 'backup') {
    const name = layout.backup(guild);
    const saved = fs.readFileSync(path.join(DATA, name), 'utf8');
    return interaction.editReply({
      content: '💾 **Backup taken.** Keep the `.json` safe — `/server-layout restore` can put everything back from it.\n' +
        '`layout-report.txt` is the audit (channel order, roles, Wick/Circle/Dyno). `layout-current.json` is the current channel order as an editable plan.',
      files: [file(name, saved), file('layout-report.txt', layout.report(guild)), file('layout-current.json', JSON.stringify(layout.currentPlan(guild), null, 2))],
    });
  }

  let kind; let payload;
  try {
    if (sub === 'apply') {
      const plan = await readJson(interaction.options.getAttachment('plan'));
      kind = 'apply'; payload = { order: plan.order ?? null, ops: plan.ops ?? null };
    } else {
      const saved = await readJson(interaction.options.getAttachment('backup'));
      if (saved.guild?.id !== guild.id) throw new Error('That backup is of another server.');
      kind = 'restore'; payload = { saved, parts: (interaction.options.getString('parts') ?? 'order,overwrites,roles').split(',') };
    }
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }

  const lines = await preview(interaction, kind, payload);
  const token = crypto.randomBytes(6).toString('hex');
  pending.set(token, { userId: interaction.user.id, kind, data: payload, expires: Date.now() + PENDING_MINUTES * 60_000 });
  return interaction.editReply({
    content: `🔍 **Preview — nothing has changed yet.** Check it, then press **Confirm** within ${PENDING_MINUTES} minutes. A fresh backup is taken first.\n` +
      '-# If Wick anti-nuke is on, make sure LACRP Management is whitelisted in Wick first, or Wick may treat bulk changes as a nuke.\n' +
      `\`\`\`\n${short(lines)}\n\`\`\``,
    files: [file('preview.txt', lines.join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sl:go:${token}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`sl:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )],
  });
}

async function button(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const job = pending.get(token);
  if (!isOwner(interaction.member) || (job && job.userId !== interaction.user.id)) {
    return interaction.reply({ content: '🔒 This is limited to **the bot owner**.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'cancel') {
    pending.delete(token);
    return interaction.update({ content: 'Cancelled — nothing was changed.', components: [], files: [], attachments: [] });
  }
  if (!job || job.expires < Date.now()) {
    pending.delete(token);
    return interaction.update({ content: '⌛ This preview expired. Run the command again.', components: [], attachments: [] });
  }
  pending.delete(token);
  await interaction.update({ content: '⏳ Taking a backup, then applying…', components: [], attachments: [] });
  const guild = interaction.guild;
  await load(guild);
  const name = layout.backup(guild);
  let lines;
  try {
    lines = await run(guild, job.kind, job.data);
  } catch (err) {
    lines = [`ERROR: ${err.message}`, 'Anything already applied stays; the backup below has the state from just before.'];
  }
  const saved = fs.readFileSync(path.join(DATA, name), 'utf8');
  return interaction.editReply({
    content: `✅ **Done** — every change was re-read from Discord (\`FAILED\` lines did not stick).\n\`\`\`\n${short(lines)}\n\`\`\``,
    files: [file('result.txt', lines.join('\n')), file(name, saved)],
  });
}

module.exports = { data, execute, buttons: { sl: button } };
