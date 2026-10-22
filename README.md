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
| `/timezone view` | everyone |
| `/availability set` / `view` / `clear` | everyone |
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
| `/timezone panel` | Supervisor+ |
| `/availability poll` | Supervisor+ |
| `/session-times` (and its Schedule buttons) | Supervisor+ |
| `/activity-check` | High Rank / Senior High Rank |
| `/quota check` | High Rank / Senior High Rank |
| `/quota tiers` | High Rank / Senior High Rank |
| `/server-analysis` | High Rank / Senior High Rank |
| `/setup` | bot owner |
| `/server-layout` | bot owner |
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

## 8. Server backup, audit, restore and channel order (`data/layout-job.json`)

The bot does this itself on startup, the same way as the permission jobs. Nothing is created, renamed or deleted.

1. In the RRHosting file manager, create `data/layout-job.json` with one of:
   - `{ "action": "backup" }`: backup and report only. Changes nothing.
   - `{ "action": "restore", "file": "server-backup-<time>.json" }`: lists what differs from that backup. Changes nothing.
   - `{ "action": "restore", "file": "server-backup-<time>.json", "apply": true }`: puts channel order, permission overwrites and role permissions/order back. Optional `"parts": ["order", "overwrites", "roles"]` limits what is restored.
   - `{ "action": "order", "plan": { ... } }`: re-orders channels in one bulk request. The plan has the same shape as `data/layout-current.json`.
2. Restart the server. The job file is deleted once it has run.
3. Download the results from `data/`:
   - `server-backup-<time>.json`: every category and channel (name, type, position, category, permission overwrites) and every role (name, position, permissions). One is written before **every** job, so you always have the state from just before a change.
   - `layout-report.txt`: channels in their current order, all roles, and an audit of Wick, Circle, Dyno and this bot (role position, permissions, channel overwrites, hidden channels, log channels).
   - `layout-current.json`: the current order, as an editable plan.
   - `layout-result.txt`: what was changed, re-read from Discord afterwards.

Keep a copy of the backup JSON on your own computer too.

**From Discord instead (bot owner only, no file manager needed):**
- `/server-layout backup` sends the backup, the audit and the current channel order back to you as files.
- `/server-layout apply plan:<file.json>` shows a preview of every change. Nothing happens until you press **Confirm**, and a fresh backup is taken first. A plan can have `"order"` (same shape as `layout-current.json`) and/or `"ops"`:
  - `"roles": [{ "role": "Dyno", "remove": ["BanMembers"] }]`
  - `"positions": [{ "role": "Circle", "above": "Staff Team" }]`
  - `"overwrites": [{ "channel": "<id>", "target": "Dyno", "set": { "ViewChannel": true, "ManageWebhooks": true } }]`
- `/server-layout restore backup:<file.json>` previews putting the server back, and applies it on **Confirm**.

No bot can change a role at or above its own top role, so Wick's role (at the very top) has to be moved by hand. If Wick anti-nuke is on, whitelist LACRP Management in Wick before applying bulk changes.

## 9. Session times: timezones, availability and `/session-times`

The timezone list, time blocks and display timezones are in `config/timezones.json`. After editing it, restart the bot so the command options update too.

**Setting it up (once)**
1. Run `/timezone panel channel:#<channel>` in the channel where members should pick their timezone. If the timezone roles don't exist yet, the bot lists them and only creates them after you press **Create roles & post panel**. They have no permissions, can't be pinged, and are placed at the bottom of the role list.
2. Our bot's role must stay above the timezone roles; new roles are created below it automatically.
3. Optional: `/setup pings post:Availability poll` picks who the poll pings (default: Session Pings).

**Staff guide (each week)**
- **Members** tap their timezone on the panel once. They then press **Set my availability** (or use `/availability set`), choose days and time blocks in their own time, and press **Save**. `/availability view` shows what they saved, and `/availability clear` deletes it. `/timezone view @member` shows anyone's timezone and current local time.
- **Early in the week (Supervisor+):** post `/availability poll`. Members pick the days and times they can play this week. Each time is shown in EST, GMT and the member's own time. Press **Results** on the poll for a day-by-time grid and the list of who answered. Answers count automatically, so nothing needs copying.
- **Planning (Supervisor+):** run `/session-times`. It shows the 3–5 best slots for the next 7 days, how many members are likely free for each, and every slot in EST, PST, GMT, CET and AEST plus your own time. It also includes a heatmap by day and hour. Press **Schedule #1** (etc.) to announce that slot as a normal scheduled session, with you as host. You can also use `/session-schedule create` as usual.
- **How the counts work:**
  - **Confirmed:** members who saved `/availability` (this repeats every week) or answered a poll for that week.
  - **Likely:** members who only picked a timezone. They are assumed free on weekday evenings and weekend afternoons/evenings in their own time, and count half as much.
  - A slot only counts a member who is free for the whole session length (default 2h, change it with `length`).
