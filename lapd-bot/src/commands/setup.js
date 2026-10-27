// /setup - builds the LAPD ranks, roles, categories and channels (admins only).
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const setup = require('../lib/setup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Build the LAPD roles and channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('preview').setDescription('Show what would change, without changing anything'))
    .addSubcommand((s) => s.setName('build').setDescription('Make the server match the LAPD layout')),

  async execute(interaction) {
    const { guild } = interaction;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Only administrators can run this.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const missing = setup.missingPermissions(guild.members.me);
    if (missing.length) {
      return interaction.editReply(
        `I'm missing these permissions: **${missing.join(', ')}**.\n`
        + `Re-invite me with this link (it keeps everything else as is), then try again:\n${setup.inviteLink(interaction.client.application.id)}`,
      );
    }

    if (interaction.options.getSubcommand() === 'preview') {
      await guild.roles.fetch();
      await guild.channels.fetch();
      const current = setup.plan(guild);
      const n = setup.summary(current);
      const file = new AttachmentBuilder(Buffer.from(setup.describe(current)), { name: 'lapd-setup-preview.txt' });
      return interaction.editReply({
        content: `**/setup build** would create ${n.roles} roles, ${n.categories} categories and ${n.channels} channels, `
          + `move or rename ${n.moved} existing channels, and remove ${n.removed} empty leftovers`
          + `${n.kept ? ` (${n.kept} leftovers have messages and will be kept)` : ''}. Full list attached.`,
        files: [file],
      });
    }

    // Progress edits are fire-and-forget: if Discord rate-limits reply edits, the build carries on anyway.
    const { done, kept, errors } = await setup.build(guild, (line) => {
      console.log(`/setup: ${line}`);
      interaction.editReply(line).catch(() => {});
    });
    const lines = [
      `Done. Created ${done.roles} roles, ${done.categories} categories and ${done.channels} channels, `
        + `updated ${done.moved} existing channels and removed ${done.removed} empty leftovers.`,
    ];
    if (kept.length) lines.push(`Kept because they have messages: ${kept.join(', ')}`);
    if (errors.length) lines.push('', `Some things failed:`, ...errors.slice(0, 15).map((e) => `- ${e}`));
    console.log(`/setup: ${lines.join('\n')}`);
    return interaction.editReply(lines.join('\n').slice(0, 2000));
  },
};
