'use strict';

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
function requirePilot(ctx) {
  if (!ctx.who || !ctx.me) fail(401, 'Sign in and create your EyeWire II profile first.');
  if (!ctx.isAdmin && !ctx.isPilot) fail(403, 'This pilot is for invited testers. Ask an EyeWire II admin to add your sign-in email.');
}

async function pilotContext(sb, who) {
  if (!who) return {who:null, me:null, isAdmin:false, isPilot:false};
  const email = encodeURIComponent(who.email);
  const [people, admins, members] = await Promise.all([
    sb('users?middleauth_email=eq.'+email+'&select=id,display_name,username,total_edits&limit=1'),
    sb('admins?email=eq.'+email+'&select=id&limit=1'),
    sb('pilot_members?email=eq.'+email+'&enabled=eq.true&select=email&limit=1'),
  ]);
  return {who, me:people[0] || null, isAdmin:admins.length>0, isPilot:members.length>0};
}
module.exports = {requirePilot, pilotContext, fail};
