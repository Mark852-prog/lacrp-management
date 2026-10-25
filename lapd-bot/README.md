# LAPD Bot

The LAPD bot for the LACRP ER:LC private server. It's separate from LACRP Management (the main
server bot in the folder above) and has its own token, settings and data.

**What it does right now:** the LAPD look (seal avatar, banner, About Me), a rotating funny
status, `/about`, and a small status web page for your domain. Features come next.

## 1. Create the bot in Discord

1. Go to https://discord.com/developers/applications, click **New Application** and name it (for example **LAPD**).
2. On the **Bot** page, click **Reset Token** and copy the token. It goes in `.env`; don't share it.
3. Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then the bot permissions
   **View Channels**, **Send Messages**, **Embed Links** and **Attach Files**. Open the link and invite the bot to the LAPD server.

You don't need to upload the avatar, banner or description by hand. On first start the bot sets them itself
from `assets/avatar.png`, `assets/banner.png` and the text in `src/lib/branding.js`.
If you change those files later the bot uploads them again on the next restart.
(Discord only allows a couple of avatar changes per hour. If it's rate-limited, the bot logs a warning and tries again next start.)

## 2. Keys (`.env`)

Copy `.env.example` to `.env` and fill it in:

| Variable | Where to get it |
|---|---|
| `DISCORD_TOKEN` | Bot page → Reset Token |
| `GUILD_ID` | Turn on Developer Mode (Discord → Settings → Advanced), right-click the LAPD server → Copy Server ID |

## 3. Hosting on RRHosting

1. Create a **Node.js** server and choose Node 22 or 24.
2. Upload everything in this `lapd-bot` folder **except** `node_modules` and `data`.
3. Create `.env` in the panel's file manager with the keys above.
4. Set the startup file to `src/index.js` (or the start command to `npm start`) and start it.
   The panel runs `npm install` for you.

You should see `Logged in as ...` and `Registered 1 slash commands` in the console.

### Domain / status page

The bot serves a small LAPD status page on the port RRHosting gives the server (`SERVER_PORT`, set
automatically). Point your RRHosting domain at the server's allocation and open it in a browser:

- `/` shows the seal, the motto, a random quote and whether the bot is online
- `/health` returns JSON (`{"online": true, ...}`) for uptime monitors

## Making it yours

- **Quotes:** edit `QUOTES` in `src/lib/branding.js`. The status changes every 5 minutes.
- **About Me:** edit `DESCRIPTION` in the same file (400 characters max).
- **Pictures:** replace `assets/avatar.png` or `assets/banner.png` (banner is 1200×480).
