const { SlashCommandBuilder } = require('discord.js');
const erlc = require('../lib/erlc');
const { brand } = require('../lib/embeds');
const { guard } = require('../lib/permissions');
const serverCheck = require('../lib/serverCheck');

const data = new SlashCommandBuilder()
  .setName('server-check')
  .setDescription('Population, players not in the Discord, and restricted vehicle use.');

async function execute(interaction) {
  if (!(await guard(interaction, 'staff'))) return;
  await interaction.deferReply();
  let server;
  try {
    server = await erlc.getServer(['Players', 'Queue', 'Vehicles']);
  } catch (err) {
    return interaction.editReply(`❌ Couldn't reach the ER:LC server: ${err.message}`);
  }
  const result = await serverCheck.run(interaction.guild, server);
  const queue = Array.isArray(server.Queue) ? server.Queue.length : 0;

  const { embed, files } = brand({ guild: interaction.guild });
  const names = result.notInDiscord.map((p) => p.name).join(', ');
  const vehicleLines = result.flagged.map(({ vehicle, owner, member, reasons, unverified }) => {
    const who = `@${owner.name}${owner.id ? ` (\`${owner.id}\`)` : ''}${owner.team ? ` (${owner.team})` : ''}`;
    const livery = vehicle.Texture ? ` · livery '${vehicle.Texture}'` : '';
    const note = unverified ? ' — *not linked, cannot verify roles*' : '';
    return `• ${who} - **${vehicle.Name}**${livery}${member ? ` (<@${member.id}>)` : ''}\n  ↳ ⚠️ ${reasons.join(' + ')}${note}`;
  });

  embed.setTitle('👤 Server Checks')
    .setDescription(`**Population:** ${server.CurrentPlayers}/${server.MaxPlayers} · **Queue:** ${queue}`)
    .addFields(
      {
        name: `Not in Discord (${result.notInDiscord.length})`,
        value: `The following players are **not in the Discord server**.\n\`\`\`\n${(names || 'N/A').slice(0, 900)}\n\`\`\``
          + (result.unknown ? `\n*${result.unknown} player(s) couldn't be checked (Bloxlink unavailable or daily limit reached).*` : ''),
      },
      { name: `Vehicle Restrictions (${result.flagged.length})`, value: (vehicleLines.join('\n') || 'None').slice(0, 1024) },
    )
    .setFooter({ text: 'Manual' });
  return interaction.editReply({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
