// /setup - builds the LAPD ranks, roles, categories and channels (admins only).
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const setup = require('../lib/setup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Build the LAPD roles and channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('preview').setDescription('Show what would be created, without changing anything'))
    .addSubcommand((s) => s.setName('build').setDescription('Create the missing roles and channels')),

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
      const n = setup.countNew(current);
      const file = new AttachmentBuilder(Buffer.from(setup.describe(current)), { name: 'lapd-setup-preview.txt' });
      return interaction.editReply({
        content: `**/setup build** would create ${n.roles} roles, ${n.categories} categories and ${n.channels} channels. `
          + 'Anything that already exists (same name) is left alone. Full list attached.',
        files: [file],
      });
    }

    const { created, errors } = await setup.build(guild, (line) => interaction.editReply(line).catch(() => {}));
    const lines = [`Done. Created ${created.roles} roles, ${created.categories} categories and ${created.channels} channels.`];
    if (errors.length) lines.push('', `Some things failed:`, ...errors.slice(0, 15).map((e) => `- ${e}`));
    return interaction.editReply(lines.join('\n').slice(0, 2000));
  },
};
