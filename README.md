# LACRP Management

A standalone Discord bot for Los Angeles City Roleplay. It handles sessions, staff duty and quota, live ER:LC logging and analytics. It shares no code or database with the Utility Bot.

## 1. Create the bot in Discord

1. Go to https://discord.com/developers/applications, click **New Application** and name it **LACRP Management**.
2. On the **General Information** page, upload the LACRP logo as the app icon. This is the bot's avatar.
3. On the **Bot** page:
   - Click **Reset Token** and copy the token. It goes in `.env` later; don't share it.
   - Under **Privileged Gateway Intents**, turn on **Server Members Intent** and **Message Content Intent**. Without them the bot can't read Vex or Utility Bot embeds, and can't list staff for quota checks.
4. Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`. Then give it these bot permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Manage Roles

   Open the link it generates and invite the bot to the LACRP server.
5. In **Server Settings → Roles**, drag the bot's role **above** the *Session Pings* role. Otherwise the "Get Session Notification!" button can't give the role out.

## 2. Keys (`.env`)

Copy `.env.example` to `.env` and fill it in:

| Variable | Where to get it |
|---|---|
| `DISCORD_TOKEN` | Bot page → Reset Token |
| `BOT_OWNER_ID` | **Your** Discord user ID. Turn on Developer Mode in Discord's Advanced settings, then right-click your name → Copy User ID. Only this person can configure the bot. |
| `GUILD_ID` | Already set to `1535653403815059546` |
| `ERLC_SERVER_KEY` | In-game: private server settings → API key |
| `BLOXLINK_API_KEY` | blox.link dashboard → your server → Developer → **Server API key** |

`.env` is in `.gitignore`. Never commit it or paste it anywhere public.

## 3. Hosting

The bot needs **Node.js 22.13 or newer** (it uses Node's built-in SQLite, so there's nothing native to compile).

**RRHosting (Pterodactyl panel):**
1. Create a **Node.js** server and choose Node 22 or 24 as the Docker image/version.
2. Upload everything in this folder **except** `node_modules` and `data`.
3. Create `.env` in the panel's file manager and add the keys above.
4. Set the startup file to `src/index.js` (or the start command to `npm start`) and start it. The panel runs `npm install` automatically.

The database is stored at `data/lacrp.db`. Back it up now and then; it holds all the history the analysis commands use.

**Free alternative:** the Oracle Cloud "Always Free" VM works well. It has its own IP address, which matters because the ER:LC API rate-limits per IP and blocks shared hosts that exceed the limit. Install Node 22, then run the bot with `pm2 start src/index.js --name lacrp`.

## 4. First run: `/setup`

Only the bot owner (`BOT_OWNER_ID`) can use `/setup`, and it can be run again at any time. Other owner-only commands: `/announcement add`, `/announcement edit`, `/announcement remove`, `/announcement send`, `/quota set` and `/quota reset`.

- `/setup roles`: assign the roles using Discord's role picker.
  - `staff`, `supervisor`, `high_rank` and `senior_high_rank` control who can use what.
  - `trial_moderator`, `trial_administrator`, `internal_affairs` and `loa` affect quota.
  - `session_pings` is the notification role.
  - `premium` and `vip`: members with either role may use restricted vehicles and liveries.
- `/setup channels`: assign the channels.
  - Staff request queue, session announcements, kill log and DC log.
  - The **read-only** sources:
    - Vex shift logs
    - the Utility Bot's infractions, promotions and resignations channels
    - **IA logs**: the channel, forum or category that holds each IA member's logs
    - **Ban requests**: the channel with the "Ban Request Submission" panels; their threads are read automatically
- `/setup view` shows the current setup. `/setup reload` reloads the files in `config/`. `/setup rescan` re-imports log channel history.

When you assign a Vex or Utility channel, the bot imports its message history, so past shifts and infractions are counted too.

"Supervisor and above" means the member has the supervisor role, or any role above it in the server's role list.

## 5. Commands

| Command | Who |
|---|---|
| `/game-status` | everyone |
| `/session-status` | everyone |
| `/session-schedule list` | everyone |
| `/server-check` | staff |
| `/staff-request` | staff |
| `/mod-calls view` | staff |
| `/session-low-activity` | staff |
| `/announcement list` | staff |
| `/staff-request-approve` | Supervisor+ |
| `/staff-request-deny` | Supervisor+ |
| Approve / Deny buttons on queued staff requests | Supervisor+ |
| `/mod-calls resolve` | Supervisor+ |
| `/mod-calls clear` | Supervisor+ |
| `/session-start` | Supervisor+ |
| `/session-end` | Supervisor+ |
| `/session-vote` | Supervisor+ |
| `/session-poll` | Supervisor+ |
| `/session-schedule create` | Supervisor+ |
| `/session-schedule cancel` | Supervisor+ |
| `/activity-check` | High Rank / Senior High Rank |
| `/quota check` | High Rank / Senior High Rank |
| `/quota tiers` | High Rank / Senior High Rank |
| `/server-analysis` | High Rank / Senior High Rank |
| `/setup` | bot owner |
| `/announcement add` | bot owner |
| `/announcement edit` | bot owner |
| `/announcement remove` | bot owner |
| `/announcement send` | bot owner |
| `/quota set` | bot owner |
| `/quota reset` | bot owner |
| `/staff-analysis` | High Rank / Senior High Rank |

**Automatic, no command needed:**
- **Kill log:** new in-game kills are posted to the kill log channel.
- **High-activity / server-full alert:** posted to the sessions channel when the server reaches 90% (`config/settings.json`). It won't post again until the server drops below 75% and 60 minutes have passed.
- **Scheduled session reminders:** the host gets a DM when a scheduled session is due. If it isn't started within 30 minutes, it counts as a **no-show**.

**In-game commands:** staff type these in ER:LC's chat.
- `:log announce <keyword>` sends the matching message (49 are built in; see `/announcement list`). A mistyped keyword gets a private reply suggesting close matches.
- `:log dcheck <exact username> yes` (`:log dc` also works) logs the check to the DC log channel and removes the player from the *Not in Discord* list shown by `/server-check`.
- `:log dcheck <exact username> no` logs the check, and the player stays on the list.

## 6. Where the data comes from

| Data | Source |
|---|---|
| Duty hours / quota | Vex **Shift Ended** embeds (only Shift Type "Staff", configurable) |
| Players, queue, kills, mod calls, moderation commands | ER:LC API, polled every 20s |
| Roblox ↔ Discord | Bloxlink (cached; about 500 lookups/day on the free key) |
| Infractions issued, strikes | Utility Bot **Infraction Notice** embeds |
| Promotions / resignations | Utility Bot "Staff Promotion" / "Staff Resignation" embeds (member + rank) |
| IA cases handled | Every "… Logged" embed in the IA logs. It's credited to whoever ran the log command, else the thread creator, else the IA member named in the channel/thread name. |
| Trial Admin bans reviewed | Ban Request panels. Credited to whoever pressed Approve/Deny, or whoever is named in the panel or thread when it's decided. |
| Sessions, no-shows | This bot's own session commands |

Mod call response time is measured between polls, so it's accurate to about ±20s. It's only counted for calls the bot saw before a moderator answered.

Charts are drawn by **quickchart.io**, a free public service. Only the chart numbers and staff display names are sent to it.

## 7. Config files (`config/`)

These are safe to edit. Run `/setup reload` afterwards.

- `announcements.json`: the **starting** list only. It's copied into the database on first start; after that, use `/announcement` in Discord.
- `quota.json`:
  - Tiers: role → weekly hours, with the first matching tier used.
  - Enforcement thresholds.
  - Promotional quota and trial rules.
  - `/quota set` overrides hours without editing the file.
- `vehicles.json`: restricted vehicles and liveries used by `/server-check`. Premium and VIP members are never flagged.
- `settings.json`: timezone, poll interval, alert thresholds, which ER:LC commands count as bans, kicks and moderations, and the Bloxlink budget.
