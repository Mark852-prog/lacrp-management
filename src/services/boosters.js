// Thank-you message in #advocates for everyone who boosts the server, listing the booster vehicles
// (config/vehicles.json restrictedVehicles) and weapons (guidelines "Restricted Weapons"). Boost perks
// are permanent.
// New boosts are posted automatically. data/booster-job.json runs once at startup:
//   {"action":"post-existing"}   - a thank-you for every current booster who hasn't had one yet
//                                  (add "reset": true to forget earlier posts, e.g. after they were deleted)
//   {"action":"redraw-existing"} - re-draw the thank-you messages already in #advocates in the current design
const fs = require('node:fs');
const path = require('node:path');
const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
} = require('discord.js');
const { config } = require('../lib/config');
const { fetchChannel } = require('../lib/guildConfig');
const { kvGet, kvSet } = require('../lib/db');
const guidelines = require('./guidelinesContent');

const ACCENT = 0xf47fff; // boost pink
const JOB = path.join(__dirname, '..', '..', 'data', 'booster-job.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boosterWeapons() {
  const section = guidelines.sections.weapons.sections.find(([title]) => /restricted/i.test(title));
  return (section?.[1] ?? '').split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
}
const boosterVehicles = () => config.vehicles.restrictedVehicles ?? [];

const numbered = (items) => items.map((v, i) => `\`${String(i + 1).padStart(2, '0')}\`  ${v}`).join('\n');

function thankYouMessage(member, { isNew = true } = {}) {
  const boosts = member.guild.premiumSubscriptionCount ?? 0;
  const since = member.premiumSinceTimestamp ? Math.floor(member.premiumSinceTimestamp / 1000) : null;
  const intro = isNew || !since
    ? `${member} just boosted **${member.guild.name}**. We're now at **${boosts} boosts**, and every one of them keeps the city running.`
    : `${member} has been boosting **${member.guild.name}** since <t:${since}:D>. We're at **${boosts} boosts**, and every one of them keeps the city running.`;
  const c = new ContainerBuilder().setAccentColor(ACCENT)
    .addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 💎 Thank you, ${member.displayName}!\n${intro}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(member.displayAvatarURL({ size: 256 }))))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# BOOSTER GARAGE\nThese vehicles are now yours to drive in-game.\n' + numbered(boosterVehicles()),
    ))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# BOOSTER ARMOURY\nRestricted weapons you may now carry.\n' + numbered(boosterWeapons()),
    ))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# These perks are permanent. Roleplay rules still apply to every vehicle and weapon.',
    ));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [member.id] } };
}

const posted = () => new Set(kvGet('booster_passes', []));
function markPosted(id) {
  const set = posted();
  set.add(id);
  kvSet('booster_passes', [...set]);
}

async function postThanks(member, opts) {
  const channel = await fetchChannel(member.client, 'advocates');
  if (!channel) throw new Error('no #advocates channel found');
  await channel.send(thankYouMessage(member, opts));
  markPosted(member.id);
}

async function onMemberUpdate(oldMember, newMember) {
  if (newMember.guild.id !== process.env.GUILD_ID) return;
  if (oldMember.premiumSince || !newMember.premiumSince) return; // only a new boost
  await postThanks(newMember, { isNew: true });
}

// Re-draws the bot's booster messages in #advocates (no new pings: editing doesn't notify anyone).
async function redrawExisting(client, guild) {
  const channel = await fetchChannel(client, 'advocates');
  if (!channel) return console.warn('[boosters] no #advocates channel found');
  const messages = await channel.messages.fetch({ limit: 100 });
  let count = 0;
  for (const msg of messages.values()) {
    if (msg.author.id !== client.user.id) continue;
    const json = JSON.stringify(msg.components.map((c) => c.toJSON()));
    if (!/BOOSTER PASS|Thank you,/.test(json)) continue;
    const userId = json.match(/<@!?(\d{15,21})>/)?.[1];
    const member = userId ? guild.members.cache.get(userId) : null;
    if (!member) continue;
    await msg.edit({ ...thankYouMessage(member, { isNew: false }), allowedMentions: { parse: [] } })
      .then(() => { count += 1; }).catch((e) => console.warn('[boosters] redraw:', e.message));
    await sleep(1500);
  }
  console.log(`[boosters] redrew ${count} booster messages`);
}

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
  fs.rmSync(JOB, { force: true });
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.members.fetch();
  if (job.action === 'redraw-existing') return redrawExisting(client, guild);
  if (job.action !== 'post-existing') return;
  if (job.reset) kvSet('booster_passes', []);
  const done = posted();
  const boosters = guild.members.cache.filter((m) => m.premiumSince && !done.has(m.id))
    .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
  let count = 0;
  for (const m of boosters.values()) {
    await postThanks(m, { isNew: false }).then(() => { count += 1; }).catch((e) => console.warn('[boosters]', m.user.tag, e.message));
    await sleep(8000); // spaced out so anti-spam bots don't remove them
  }
  console.log(`[boosters] posted ${count} thank-you messages for existing boosters`);
}

function attach(client) {
  client.on('guildMemberUpdate', (o, n) => onMemberUpdate(o, n).catch((e) => console.warn('[boosters]', e.message)));
}

module.exports = { attach, runJob, thankYouMessage, boosterVehicles, boosterWeapons };
