// Guidelines text exactly as written by the server owner (only list bullets turned into Discord lists).
// Used by src/services/guidelines.js. Emojis are the server's own (white set), written as :name:.

const discord = {
  label: 'Discord Regulations', emoji: 'w_phone', group: 'reg',
  intro: 'By participating in this Discord server, you agree to follow the rules below. Violations may result in mutes, kicks, bans, or other moderation action at staff discretion.',
  rules: [
    ['Rule 1 Alternate Accounts', 'The use of alternate accounts to evade a mute, kick, or ban is strictly prohibited. Any alt found to be evading punishment will be banned along with the main account.'],
    ['Rule 2 No Spamming', 'Don’t spam messages, images, emojis, or reactions. This includes excessive/repeated bot commands, misusing spoiler tags, or mass-tagging users who aren’t active in the conversation. Repeated spam will result in an automatic mute.'],
    ['Rule 3 No Online Dating', 'This is a roleplay community server, not a dating platform. E-dating, flirting campaigns, or using the server to seek a relationship is prohibited and will result in a permanent ban.'],
    ['Rule 4 Impersonation', 'Do not impersonate staff, other members, department leadership, or the server itself (e.g. fake announcement accounts, spoofed usernames/avatars). This includes misleading nicknames intended to confuse other members.'],
    ['Rule 5 Staff Authority & Appeals', 'Staff decisions are final in the moment, but not beyond question. If you believe a moderation action was unfair or made in error, you may open a ticket to request a review. Do not argue with staff in public channels — take it to DMs or a support ticket instead.'],
    ['Rule 6 Advertising', 'Do not advertise other Discord servers, communities, social media pages, or external projects that are not officially part of the LARP Community’s network of departments. Unauthorized advertising, including via DMs to other members, will result in a ban.'],
    ['Rule 7 No Political or Religious Discussion', 'This server is not a venue for political or religious debate. Please keep discussions of political and religious topics out of all channels, including in profile statuses, custom roles, or pinned messages.'],
    ['Rule 8 Language', 'Casual swearing is allowed in moderation. Excessive profanity, especially when directed at another user aggressively, is not permitted and may result in a mute or warning.'],
    ['Rule 9 Respect & Common Sense', 'Treat other members with basic respect. Disagreements happen — the goal is to de-escalate, not fuel the fire. If a conflict starts getting out of hand, ping a Moderator or Junior High Rank member rather than handling it yourself or retaliating.'],
    ['Rule 10 Prohibited Content', 'Do not post lewd, graphic, illegal, or otherwise explicit material anywhere on the server. This includes content shared through links, attachments, embeds, or profile pictures/banners. Violating this rule will result in an immediate permanent ban and may be reported to Discord Trust & Safety.'],
    ['Rule 11 NSFW & Suggestive Content', 'NSFW (Not Safe For Work) content, e-dating, and overly suggestive messages or media are not permitted anywhere in the server. If you’re not sure whether something crosses the line, don’t post it — ask a Moderator or Junior High Rank member first.'],
    ['Rule 12 Use Channels Properly', 'Stick to the intended purpose of each channel. Channel topics and pinned messages explain what belongs where read them before posting. Off-topic chatter in channels not meant for general conversation may result in a warning or mute.'],
    ['Rule 13 Server & Discord ToS Compliance', 'All members must also comply with Discord’s Terms of Service and Community Guidelines at all times. Server-specific rules exist in addition to Discord’s own policies, not in place of them.'],
    ['Rule 14 Scams, Malware & Hacking', 'Do not share links, files, or content containing malicious software (IP grabbers, malware, RATs, etc.), phishing links, scam attempts, or anything designed to compromise another member’s account or device. This results in a permanent ban.'],
    ['Rule 15 Brainrot / Low-Effort Slang Spam', 'Keep chat readable. Excessive or spammy use of “brainrot” terms (e.g. “sigma,” “skibidi,” “rizz,” “gyatt,” and similar) that derails conversation or clutters chat is not allowed and may result in a mute. Occasional, non-disruptive use in casual banter is fine — repeated spam of it is not.'],
    ['Rule 16 Harassment & Hate Speech', 'Harassment, hate speech, racism, homophobia, transphobia, sexism, ableism, Nazi or extremist symbolism/rhetoric, and targeted trolling are not tolerated under any circumstance — including “joking” use of slurs. This is a zero-tolerance rule and will typically result in an immediate ban.'],
    ['Rule 17 Doxxing & Personal Information', 'Sharing another person’s private information without consent — full name, address, phone number, IP address, photos, workplace, school, or similar identifying details — is strictly forbidden. This applies whether the information belongs to a server member or someone outside the server. Violators will be permanently banned.'],
  ],
  outro: 'These rules may be updated at any time. Members are responsible for staying informed of changes. Not every scenario can be listed — use good judgment, and staff may act on behavior that clearly violates the spirit of these rules even if it isn’t explicitly written above',
};

const ingame = {
  label: 'In-Game Regulations', emoji: 'w_police', group: 'reg',
  intro: 'These rules do not account for every possible scenario. Actions not explicitly mentioned may still be deemed unacceptable at staff discretion. All players are expected to follow both the letter and the spirit of the rules. Staff decisions are final and not subject to debate.',
  rules: [
    ['R1. Fail Roleplay (FRP)', 'Maintain a realistic profile at all times. Your character’s actions should reflect what a reasonable person would do in real life. Examples include, but are not limited to:\n- Fleeing from a routine traffic stop without a realistic reason.\n- Pulling rifles or other large firearms out of thin air. Long guns must be visibly equipped or retrieved from a vehicle.\n- Ignoring injuries, crashes, or other realistic consequences.\n- Escaping handcuffs or police custody in unrealistic ways.\n- Wearing equipment or using items your character would not realistically possess.\n- Making unrealistic decisions when faced with overwhelming force.'],
    ['R2. No Intent to Roleplay (NITRP)', 'Roleplay every scenario fully — crashes, arrests, medical RP, and more. Do not avoid RP or cut situations short.\nRespawn timers:\n- If no EMS are online, wait 3 minutes after being downed before respawning.\n- If EMS are online, wait for EMS or LEO Med RP within a reasonable time before respawning.\n- Respawning without proper clearance to avoid roleplay consequences is considered Fail Roleplay and may result in disciplinary action.'],
    ['R3. Random & Vehicle Deathmatch (RDM/VDM)', 'Do not shoot, injure, or kill another player without a valid in-character reason. Do not ram or damage another player’s vehicle without a valid reason. This includes shooting, punching, or ramming without proper cause.'],
    ['R4. New Life Rule (NLR)', 'When your character dies, you may not remember your past life, seek revenge, or return to the same scene. You may only return to the same area 10 minutes after death.'],
    ['R5. Powergaming', 'Do not force unrealistic actions onto another player or abuse game mechanics to gain an unfair advantage. Examples include:\n- Ignoring injuries.\n- Performing impossible stunts.\n- Switching characters to avoid arrest.\n- Breaking free from restraints without a valid roleplay opportunity.'],
    ['R6. Metagaming', 'Do not use out-of-character information to influence in-character decisions. This includes stream sniping, using Discord conversations to benefit your roleplay, and sharing information between characters.'],
    ['R7. Common Sense', 'Not every scenario can be covered by a written rule. All players are expected to use common sense and maintain realistic, respectful roleplay at all times. Staff may moderate behavior that clearly violates the spirit of these rules even if not explicitly listed.'],
    ['R8. Avatar Standards', 'All avatars must remain realistic. Fantasy characters, oversized avatars, animal costumes, and unrealistic morphs are not permitted outside approved seasonal events. Only authorized law enforcement/EMS may use department-issued models. Do not argue with staff about an unrealistic avatar — if told to change it, you must change it.'],
    ['R9. Tool Abuse', 'Do not use tools without a legitimate roleplay reason. For example, using traffic cones to box in a vehicle without cause, or misusing any placeable item to trap, grief, or gain an unfair advantage over another player.'],
    ['R10. MIC / Police Radio Conduct', 'Do not misuse law enforcement vehicle microphones or the police radio. This includes excessive or unnecessary use, side-chatting, or using it during hostage scenes for out-of-character purposes.'],
    ['R11. Robbery Cooldown', 'Do not spam or chain robberies. There must be a reasonable cooldown between robbery scenes:\n- You may not commit back-to-back robberies (e.g., robbing a store and immediately hitting another store or jewelry location).\n- Repeatedly targeting the same or nearby locations in a short window is considered robbery spam and will be treated as a rule violation, even if a strict timer hasn’t technically elapsed.'],
    ['R12. Roleplay request System', 'Major roleplay scenarios require an approved request before they begin. RP requests are required for scenarios including:\n- Bank robberies\n- DUI RP\n- Checkpoints\n- Roadwork\n- Hostage situations\n- Shootings in hospitals, or courthouses or any public building.\n- Kidnapping or killing first responders\n- Any roleplay expected to require a large law enforcement response\n\nWhile a priority timer is active, you may not start pursuits, shootouts, robberies, or hostage scenes outside the approved scene. You must remain legal and avoid creating additional large scenes.'],
    ['R13. Hostages & Major Roleplay', 'Fire Department, EMS, and Department of Transportation employees may not be kidnapped unless specifically permitted under the Priority System. Players in an approved priority are expected to actively participate and may not abandon it without a valid roleplay reason.'],
    ['R14. Traffic Stops', 'You may not evade or shoot law enforcement during a traffic stop without a valid reason (e.g., active BOLO, warrant, wanted for robbery or murder). You cannot run or shoot an officer just to avoid receiving a citation.'],
    ['R15. Cuffing & Arrest Procedures', 'When cuffing an individual, you must always initiate the cuffing motion by saying “cuffs” before restraining them, and roleplay the arrest realistically. Suspects should only be cuffed when it is realistically possible.'],
    ['R16. Driving Standards', 'Drive as you would in real life, no unrealistic speeding or reckless driving without justification.\n- Do not exceed 120 mph in the County or 100 mph in the City, unless actively being pursued by law enforcement.\n- Excessive off-roading or driving across terrain inaccessible to normal vehicles is prohibited without a realistic reason.\n- All vehicle accidents must be roleplayed unless caused by server desynchronization.'],
    ['R17. Yielding & Emergency Vehicles', 'You must yield to emergency vehicles. Do not interfere with chases or intentionally cause crashes or desync. Violations may result in FRP warnings.'],
    ['R18. Scene Interference', 'Do not involve yourself in roleplay scenes you were not originally part of. As a civilian, you may not approach or involve yourself in traffic stops or other ongoing situations. Always respect barriers, cones, and restricted areas at active scenes. Repeatedly driving through or disrupting active scenes is prohibited.'],
    ['R19. Group / Mafia Roleplay', 'Criminal activity groups are limited to 4 players. Whitelisted mafias may have up to 6 players during criminal activity.'],
    ['R20. Safe Zones / Green Zones', 'Never kill or shoot players in a safe zone without valid cause.\n- If you have an ongoing roleplay scene already active in a safe zone, this rule does not apply to that scene.\n- Never cause a shootout or prison break at County Jail or the hospital without permission from a Moderator.\n- Criminal activity is otherwise prohibited within designated safe zones, including emergency service stations and player spawn locations.'],
    ['R21. Value of Life', 'Your character should value their life at all times. If faced with overwhelming odds, you are expected to surrender or comply when appropriate instead of making unrealistic attempts to escape or fight.'],
    ['R22. Breaking Character', 'Remain in character during roleplay. Avoid unnecessary out-of-character conversations that disrupt immersion.'],
    ['R23. Poor Quality Roleplay', 'Contribute meaningful, engaging roleplay. Repeatedly performing the same scenario, refusing to develop roleplay, or intentionally lowering roleplay quality may result in moderation.'],
    ['R24. Cop Baiting', 'Purposely committing crimes solely to attract law enforcement attention is prohibited.'],
    ['R25. Combat Logging', 'Leaving the server to avoid roleplay, arrest, death, moderation, or any in-progress interaction is prohibited. Disconnecting intentionally to avoid consequences may result in disciplinary action.'],
    ['R26. Corruption & Staff Conduct on Duty', 'Officers and staff are expected to represent their department with integrity while on duty. The following are considered corruption and will not be tolerated:\n- Using a badge, department vehicle, or department authority for personal gain or to bypass normal roleplay consequences.\n- Intentionally sabotaging cases, evidence, or arrests for out-of-character reasons.\n- Trolling, favoritism, or abuse of power while on duty — including unwhitelisted members misusing department access.\n- Leaking internal department information for personal or criminal benefit.\n\nCorruption reports will be reviewed by department leadership and Server Staff jointly. Confirmed corruption results in immediate removal from the department, in addition to any standard infraction points for the underlying behavior.'],
    ['R27. AFK Policy', 'Players may not remain AFK for extended periods. AFK players may be removed to make room for active players, especially when a server queue exists.'],
    ['R28. Loopholes', 'Intentionally abusing loopholes, technicalities, or omissions within the rules to gain an unfair advantage is prohibited. Claiming behavior is “not specifically listed” does not excuse a clear violation of the intent of the rules.'],
    ['Rule 29. Moderation System', 'This server uses a warning-based escalation system tied to a rolling time window:\n- 3 warnings within any 2-hour window → automatic 30-minute kick.\n- 2nd escalation (a further 3 warnings within 2 hours after returning) → 3 hour kick\n\nIndividual warnings do not expire immediately, they only stop counting toward an escalation once more than 2 hours have passed since that warning was issued. A kick or ban resets the warning count back to zero once served.\n\nMembers who believe a warning, kick, or ban was issued incorrectly may open an Internal Affairs Ticket within 48 hours of the action. Reviews are only intended to correct staff mistakes and require sufficient evidence to be considered.'],
  ],
  outro: 'These rules may be updated at any time. Players are responsible for remaining informed of changes.',
};

const weapons = {
  label: 'Banned Weapons', emoji: 'w_gun', group: 'ban',
  sections: [
    ['Restricted Weapons', '- M249\n- PPSH 41\n- Kriss Vector\n- Colt Python\n- Remington 700'],
  ],
};

const vehicles = {
  label: 'Banned Vehicles', emoji: 'w_car', group: 'ban',
  sections: [
    ['Restricted vehicles', '- Chevon Corbeta RZR 2014\n- Chevelon Corbeta 8 2023\n- Takeo Experience 2021\n- Falcon Heritage 2021\n- Surrey 650S 2016\n- Strugatti Ettore 2020\n- Chevelon Corbeta X08 2014\n- Chevelon Corbeta 1M Edition 2014\n- Chevelon Corbeta X08 2014\n- Ferdinand Rapido S 2022'],
    ['Certified Civilian Access', '- BKM Hofmeister 2020\n- Vellfire Puremia 2025\n- BKM Hofmeister F 2021'],
    ['Prohibited vehicles', '- Pea Car\n- Kovac Heladera 2023'],
  ],
};

const roleplays = {
  label: 'Banned Roleplays', emoji: 'w_mask', group: 'ban',
  sections: [
    [null, '- Bomb Roleplay\n- Self harm/ suicidal Roleplay\n- Sexual Roleplay\n- Consuming Drugs Roleplay.\n\nDoing any of these in-game will result you in an In game ban.'],
  ],
};

const main = {
  title: 'LOS ANGELES ROLEPLAY GUIDELINES', emoji: 'w_court',
  intro: 'This channel holds everything you need to know before you start roleplaying here. Please understand that breaking the rules will result in **moderation**. Take a few minutes to read every rule carefully before you start playing. We expect all members to follow them properly so we can keep the community running to the **standards required by ER:LC**.',
  regulations: { title: 'Regulations', emoji: 'w_badge' },
  banned: { title: 'Banned Items', emoji: 'w_jail' },
};

module.exports = { main, sections: { discord, ingame, weapons, vehicles, roleplays } };
