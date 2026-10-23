// Answer directly instead of "thinking..." whenever possible.
//
// A deferred reply is finished through the webhooks route (PATCH .../messages/@original), which Discord
// sometimes rate limits for a long time on shared hosting IPs. A direct reply goes through the
// interaction callback route, which isn't affected. So deferReply() only schedules the real defer:
// if the command answers within ~2.5 s (most do), the answer is sent as a direct reply and the
// webhooks route is never used. Slow commands still get "thinking..." in time for Discord's 3 s limit.
const { MessageFlags } = require('discord.js');

const ANSWER_WITHIN_MS = 2500;
const SAFETY_MS = 2200;

function withDeferFlags(options, deferOptions) {
  const payload = typeof options === 'string' ? { content: options } : { ...options };
  const deferFlags = Number(deferOptions?.flags ?? 0) & MessageFlags.Ephemeral;
  if (deferFlags) payload.flags = Number(payload.flags ?? 0) | deferFlags;
  return payload;
}

function install(interaction) {
  const original = {
    deferReply: interaction.deferReply.bind(interaction),
    reply: interaction.reply.bind(interaction),
    editReply: interaction.editReply.bind(interaction),
    followUp: interaction.followUp.bind(interaction),
  };
  let state = 'none'; // none -> pending -> (replied | deferring -> deferred)
  let deferOptions;
  let timer;
  let deferring;

  const realDefer = () => {
    if (state !== 'pending') return;
    state = 'deferring';
    deferring = original.deferReply(deferOptions)
      .then(() => { state = 'deferred'; })
      .catch((err) => { state = 'deferred'; console.warn('[quick reply] defer failed:', err.message); });
  };
  const answerDirectly = (options) => {
    clearTimeout(timer);
    state = 'replied';
    return original.reply(withDeferFlags(options, deferOptions));
  };

  interaction.deferReply = async (options) => {
    if (state !== 'none') return;
    state = 'pending';
    deferOptions = options;
    const left = ANSWER_WITHIN_MS - (Date.now() - interaction.createdTimestamp);
    timer = setTimeout(realDefer, Math.max(0, left));
  };
  interaction.editReply = async (options) => {
    if (state === 'pending') return answerDirectly(options);
    if (state === 'deferring') await deferring;
    return original.editReply(options);
  };
  interaction.reply = async (options) => {
    if (state === 'pending') return answerDirectly(options);
    if (state === 'deferring' || state === 'deferred') {
      if (state === 'deferring') await deferring;
      const { flags, ...rest } = typeof options === 'string' ? { content: options } : options;
      return original.editReply(rest);
    }
    state = 'replied';
    return original.reply(options);
  };
  const showModal = interaction.showModal?.bind(interaction);
  if (showModal) interaction.showModal = (...args) => { state = 'replied'; return showModal(...args); };
  interaction.followUp = async (options) => {
    if (state === 'pending') return answerDirectly(options);
    if (state === 'deferring') await deferring;
    return original.followUp(options);
  };

  // Safety net: a command that hasn't answered or deferred by now (slow API call, channel post, DM...)
  // gets a private "thinking..." so Discord doesn't drop it; its answer then lands there.
  setTimeout(() => {
    if (state !== 'none' || interaction.replied || interaction.deferred) return;
    state = 'pending';
    deferOptions = { flags: MessageFlags.Ephemeral };
    realDefer();
  }, Math.max(0, SAFETY_MS - (Date.now() - interaction.createdTimestamp)));
}

// Same safety net for buttons and menus: if the handler is slow, acknowledge with deferUpdate() and
// route its later answer to the right place (update -> edit the message, reply -> follow-up).
function installComponent(interaction) {
  const original = {
    update: interaction.update.bind(interaction),
    reply: interaction.reply.bind(interaction),
    deferUpdate: interaction.deferUpdate.bind(interaction),
    deferReply: interaction.deferReply.bind(interaction),
    editReply: interaction.editReply.bind(interaction),
    followUp: interaction.followUp.bind(interaction),
  };
  let auto; // promise of our own deferUpdate, once the safety net fired
  let acked = false; // the handler already answered (or is answering)

  setTimeout(() => {
    if (acked || interaction.replied || interaction.deferred) return;
    auto = original.deferUpdate().catch((err) => console.warn('[quick reply] auto-defer failed:', err.message));
  }, Math.max(0, SAFETY_MS - (Date.now() - interaction.createdTimestamp)));

  interaction.update = async (options) => {
    if (!auto) { acked = true; return original.update(options); }
    await auto;
    return original.editReply(options);
  };
  interaction.reply = async (options) => {
    if (!auto) { acked = true; return original.reply(options); }
    await auto;
    return original.followUp(options);
  };
  interaction.deferUpdate = async (options) => { if (auto) return auto; acked = true; return original.deferUpdate(options); };
  interaction.deferReply = async (options) => {
    if (!auto) { acked = true; return original.deferReply(options); }
    await auto;
  };
  const showModal = interaction.showModal?.bind(interaction);
  if (showModal) interaction.showModal = (...args) => { acked = true; return showModal(...args); };
}

module.exports = { install, installComponent };
