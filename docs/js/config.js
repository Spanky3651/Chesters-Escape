/*
 * Chester's Escape - site config.
 * api: the game server (Cloudflare Worker) address.
 *      Empty means the site shows "Coming soon". Opened from your own PC, empty runs the practice game.
 */
window.CGConfig = {
  api: 'https://chester-game.msploit.workers.dev',
  // MSploit's own visits stay out of GoatCounter. Once either ID shows up in a browser, that browser
  // is marked with GoatCounter's own opt-out (the same flag #toggle-goatcounter sets) and stops counting.
  owner: { discord: '909550896571113492', beatleader: '76561199153577883' }
};
// Shared by the game and the designer.
window.CGSkipOwner = function (discordId, blId) {
  var o = window.CGConfig.owner || {};
  if (!((discordId && String(discordId) === o.discord) || (blId && String(blId) === o.beatleader))) return;
  try { if (localStorage.getItem('skipgc') !== 't') localStorage.setItem('skipgc', 't'); } catch (e) {}
};
