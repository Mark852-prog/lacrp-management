// Ready-made custom embeds, created once if missing. After that they're normal saved embeds:
// edit them with /embed edit or the web editor, post them with /embed post.
const ce = require('../lib/customEmbeds');

function verification(guildId) {
  return {
    color: '#e67e22',
    topImage: 'la',
    bottomImage: 'la_small',
    title: '✅ Verify Your Roblox Account',
    description:
      '**Welcome to Los Angeles City Roleplay!**\n' +
      'To unlock the rest of the server, link your Roblox account with **Bloxlink**. It takes less than a minute.\n\n' +
      '### How to verify\n' +
      '**1.** Press **Verify with Bloxlink** below.\n' +
      '**2.** Log in with Discord and pick the Roblox account you play ER:LC on.\n' +
      '**3.** Come back here — your roles and nickname update automatically.\n\n' +
      '-# Your server nickname is set to your exact Roblox username so staff can find you in-game.',
    fields: [
      { name: '🎮 Sessions', value: 'Get pinged and join our ER:LC sessions.', inline: true },
      { name: '🚓 Departments', value: 'Apply for LAPD, LAFD, EMS and more.', inline: true },
      { name: '💬 Community', value: 'Chat, events and giveaways.', inline: true },
    ],
    footer: 'Los Angeles City Roleplay · Verification',
    buttons: [
      { label: 'Verify with Bloxlink', emoji: '🔗', action: 'link', url: `https://blox.link/verify/${guildId}` },
      {
        label: 'Why verify?', emoji: '❓', style: 'secondary', action: 'reply',
        reply: {
          title: 'Why do we verify?',
          text:
            'Verifying links your Discord to your Roblox account. It lets us:\n\n' +
            '- **Give you the right roles** automatically (departments, ranks, VIP).\n' +
            '- **Match you in-game** — your nickname becomes your Roblox username.\n' +
            '- **Keep the server safe** — alts and ban evaders are much easier to spot.\n\n' +
            '-# Bloxlink only sees your public Roblox profile. We never see your password.',
          footer: 'Los Angeles City Roleplay',
          image: null,
          links: [],
        },
      },
      {
        label: 'Need help?', emoji: '🛠️', style: 'secondary', action: 'reply',
        reply: {
          title: 'Verification help',
          text:
            '### Roles didn\'t update?\n' +
            'Run **`/update`** anywhere in the server and Bloxlink will refresh your roles.\n\n' +
            '### Linked the wrong Roblox account?\n' +
            'Press **Verify with Bloxlink** again and pick the right account, then run **`/update`**.\n\n' +
            '### Still stuck?\n' +
            'Open a ticket in the support channel and a staff member will help you out.',
          footer: 'Los Angeles City Roleplay',
          image: null,
          links: [],
        },
      },
    ],
    menu: null,
  };
}

function ensure() {
  const guildId = process.env.GUILD_ID;
  if (!ce.byName('verification')) {
    ce.create('verification', verification(guildId));
    console.log('[embeds] created starter embed "verification" - post it with /embed post name:verification');
  }
  // The guidelines moved to /panel guidelines; drop the earlier never-posted embed version.
  const old = ce.byName('guidelines');
  if (old && !old.posts.length && old.data.menu?.options?.[0]?.label === 'Discord Regulations') ce.remove(old.id);
}

// Re-renders every posted custom embed, e.g. after emojis were re-uploaded with new IDs.
async function refreshAll(client) {
  for (const e of ce.list()) await ce.refreshPosts(client, e.id).catch((err) => console.warn('[embeds]', err.message));
  await require('./guidelines').refresh(client).catch((err) => console.warn('[guidelines]', err.message));
  await require('./departments').refresh(client).catch((err) => console.warn('[departments]', err.message));
}

module.exports = { ensure, refreshAll };
