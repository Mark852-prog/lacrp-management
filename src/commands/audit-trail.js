// Secret command: only one Discord user (SECRET_USER_ID below) can run it. Everyone else is refused with a
// plain "no permission" message. The result goes to that user's DMs, never into the channel.
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
require('../lib/accessLog');
const { all } = require('../lib/db');

const SECRET_USER_ID = '1533745621163442282';

const data = new SlashCommandBuilder()
  .setName('audit-trail')
  .setDescription('Private.')
  .setDefaultMemberPermissions(0n) // hidden from everyone except server admins in the command list
  .addIntegerOption((o) => o.setName('limit').setDescription('How many entries (default 100)').setMinValue(1).setMaxValue(1000))
  .addUserOption((o) => o.setName('member').setDescription('Only this member'));

async function execute(interaction) {
  if (interaction.user.id !== SECRET_USER_ID) {
    return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const limit = interaction.options.getInteger('limit') ?? 100;
  const user = interaction.options.getUser('member');
  const rows = all(
    'SELECT * FROM embed_access WHERE (? IS NULL OR user_id = ?) ORDER BY id DESC LIMIT ?',
    user?.id ?? null, user?.id ?? null, limit,
  );
  const lines = rows.map((r) => {
    const when = new Date(r.at * 1000).toISOString().replace('T', ' ').slice(0, 19);
    return `${when} UTC | ${r.user_tag} (${r.user_id}) | opened "${r.item}" | panel: ${r.embed_name}${r.file ? ` | file: ${r.file}` : ''}`;
  });
  const body = lines.length ? lines.join('\n') : 'No panel clicks recorded yet.';
  const dm = body.length < 1800
    ? { content: `Panel access log (newest first):\n\`\`\`\n${body}\n\`\`\`` }
    : { content: `Panel access log: ${rows.length} entries (newest first).`, files: [new AttachmentBuilder(Buffer.from(body), { name: 'panel-access-log.txt' })] };
  try {
    await interaction.user.send(dm);
  } catch {
    return interaction.editReply('I could not DM you. Open your DMs for this server (Privacy Settings) and run it again.');
  }
  return interaction.editReply('Sent to your DMs.');
}

module.exports = { data, execute };
