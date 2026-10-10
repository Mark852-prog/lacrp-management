const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { brand, plain, chunkLines } = require('../lib/embeds');
const store = require('../lib/announcements');
const erlc = require('../lib/erlc');
const panels = require('../services/panels');

// Keep the /panel commands list in sync after any change.
const refreshPanel = () => panels.refreshCommands().catch((e) => console.warn('[commands panel]', e.message));

const TYPE_CHOICES = [{ name: 'Hint bar (:h)', value: 'h' }, { name: 'Full-screen message (:m)', value: 'm' }];
const keywordOption = (o, desc = 'Announcement keyword') => o.setName('keyword').setDescription(desc).setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('announcement')
  .setDescription('The in-game ":log announce <keyword>" messages. Only the bot owner can change them.')
  .addSubcommand((s) => s.setName('list').setDescription('Show every keyword and its message (any staff).'))
  .addSubcommand((s) => s.setName('add').setDescription('Add a new announcement.')
    .addStringOption((o) => o.setName('keyword').setDescription('One word, e.g. "pizza" (letters, numbers, - or _)').setRequired(true).setMaxLength(32))
    .addStringOption((o) => o.setName('message').setDescription('What gets announced in-game').setRequired(true).setMaxLength(store.MAX_MESSAGE))
    .addStringOption((o) => o.setName('type').setDescription('How it shows in-game (default: hint bar)').addChoices(...TYPE_CHOICES))
    .addStringOption((o) => o.setName('label').setDescription('Optional name shown in the list, e.g. "Peace Pizza"').setMaxLength(50)))
  .addSubcommand((s) => s.setName('edit').setDescription('Change an announcement\'s keyword, message, type or label.')
    .addStringOption((o) => keywordOption(o, 'Announcement to edit'))
    .addStringOption((o) => o.setName('new_keyword').setDescription('Rename the keyword').setMaxLength(32))
    .addStringOption((o) => o.setName('message').setDescription('New message').setMaxLength(store.MAX_MESSAGE))
    .addStringOption((o) => o.setName('type').setDescription('New type').addChoices(...TYPE_CHOICES))
    .addStringOption((o) => o.setName('label').setDescription('New label').setMaxLength(50)))
  .addSubcommand((s) => s.setName('remove').setDescription('Delete an announcement.')
    .addStringOption((o) => keywordOption(o, 'Announcement to delete')))
  .addSubcommand((s) => s.setName('send').setDescription('Send an announcement in-game right now (same as :log announce).')
    .addStringOption((o) => keywordOption(o, 'Announcement to send')));

const describe = (a) => `\`${a.keyword}\`${a.label ? ` · ${a.label}` : ''} (${a.type === 'm' ? ':m' : ':h'})\n> ${a.message}`;

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  // Any staff member can see the list; changing anything is owner-only.
  if (!(await guard(interaction, sub === 'list' ? 'staff' : 'owner'))) return;
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (sub === 'list') {
    const all = store.list();
    const { embed, files } = brand({ guild: interaction.guild });
    embed.setTitle(`📢 In-game Announcements (${all.length})`)
      .setDescription('Staff type `:log announce <keyword>` in the ER:LC chat.\nManage with `/announcement add | edit | remove`.');
    // One page per message: Discord caps a message's embeds at 6000 characters in total.
    const pages = chunkLines(all.map((a) => `**\`${a.keyword}\`**${a.label ? ` — ${a.label}` : ''}\n${a.message}`), 3800);
    await interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral });
    for (const [i, page] of pages.entries()) {
      await interaction.followUp({ embeds: [plain().setDescription(page).setFooter({ text: `Page ${i + 1}/${pages.length}` })], flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (sub === 'add') {
    const keyword = store.normalize(interaction.options.getString('keyword'));
    if (!store.KEYWORD_RE.test(keyword)) return reply('⚠️ Keywords must be one word: letters, numbers, `-` or `_` (max 32).');
    if (store.find(keyword)) return reply(`⚠️ \`${keyword}\` already exists — use \`/announcement edit\` to change it.`);
    store.add({
      keyword,
      message: interaction.options.getString('message'),
      type: interaction.options.getString('type') ?? 'h',
      label: interaction.options.getString('label'),
      by: interaction.user.id,
    });
    refreshPanel();
    return reply(`✅ Added. In-game: \`:log announce ${keyword}\`\n${describe(store.find(keyword))}`);
  }

  const keyword = interaction.options.getString('keyword');
  const current = store.find(keyword);
  if (!current) return reply(`⚠️ No announcement with keyword \`${store.normalize(keyword)}\`. See \`/announcement list\`.`);

  if (sub === 'edit') {
    const newKeyword = interaction.options.getString('new_keyword');
    const changes = {
      newKeyword,
      message: interaction.options.getString('message'),
      type: interaction.options.getString('type'),
      label: interaction.options.getString('label'),
    };
    if (!Object.values(changes).some((v) => v != null)) return reply('Nothing to change — fill in at least one option.');
    if (newKeyword) {
      const nk = store.normalize(newKeyword);
      if (!store.KEYWORD_RE.test(nk)) return reply('⚠️ Keywords must be one word: letters, numbers, `-` or `_` (max 32).');
      if (nk !== current.keyword && store.find(nk)) return reply(`⚠️ \`${nk}\` is already used by another announcement.`);
    }
    const updated = store.edit(current.keyword, changes, interaction.user.id);
    refreshPanel();
    return reply(`✏️ Updated. In-game: \`:log announce ${updated.keyword}\`\n${describe(updated)}`);
  }

  if (sub === 'remove') {
    store.remove(current.keyword);
    refreshPanel();
    return reply(`🗑️ Removed \`${current.keyword}\`.\n> ${current.message}`);
  }

  if (sub === 'send') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await erlc.runCommand(`:${current.type} ${current.message}`);
      return interaction.editReply(`📣 Sent in-game:\n> ${current.message}`);
    } catch (err) {
      return interaction.editReply(`❌ Couldn't send: ${err.message}`);
    }
  }
}

async function autocomplete(interaction) {
  if (!can(interaction.member, 'owner')) return interaction.respond([]);
  const q = store.normalize(interaction.options.getFocused());
  return interaction.respond(store.search(q).map((a) => ({ name: `${a.keyword}${a.label ? ` — ${a.label}` : ''}`.slice(0, 100), value: a.keyword })));
}

module.exports = { data, execute, autocomplete };
