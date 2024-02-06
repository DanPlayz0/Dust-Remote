const axios = require('axios');

const createCode = (length) => {
  let alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", code = "";
  for (let i = 0; i < length; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const apiVer = "/v10";
const baseURL = `https://discord.com/api${apiVer}`;

const fetch = (options) => {
  return new Promise((resolve, reject) => {
    axios(options)
      .then(res => resolve(res.data))
      .catch(err => {
        if (err.response.data.retry_after) return setTimeout(() => resolve(fetch(options)), err.response.data.retry_after);
        reject(err.response);
      });
  });
}


const backupServer = async (token, guildId, backupCodeInput) => {
  const ctx = {};
  ctx.dfetch = (url) => fetch({
    url: `${baseURL}/${url}`,
    method: "GET",
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  });

  const guild = await ctx.dfetch(`guilds/${guildId}`);
  if (!guild || guild.code) return false;

  ctx.guild = guild;
  ctx.token = token;
  ctx.clientId = Buffer.from(ctx.token.replace("Bot ", "").split('.')[0], 'base64').toString('ascii');
  ctx.database = new (require('./Database'))(require('../config').mongo_uri);
  await ctx.database.init();
  const backupCode = backupCodeInput ?? createCode(21);
  console.log("Creating backup with code: "+ backupCode);
  await createBackup(ctx, backupCode);
  ctx.database.close();
  return true;
}
module.exports = backupServer;

const urltoBase64 = async (ctx, id, url, name, imageType, getData = false) => {
  const assetExists = await ctx.database.findOne('assets', { id, imageType });
  if (assetExists && getData) return assetExists;
  if (assetExists) return;
  const image = await axios({ url, method: "GET", responseType: 'arraybuffer' });
  const dbEntry = await ctx.database.insertOne('assets', { id, url, imageType, name, base64: Buffer.from(image.data, 'binary').toString('base64') });
  if (getData) return dbEntry;
  return;
}

const createBackup = async (ctx, backupCode) => {
  const bkObj = {
    code: backupCode,
    guildid: ctx.guild.id,
    userid: ctx.clientId,
    access: ["209796601357533184"],
    name: ctx.guild.name,
    assets: {
      icon: ctx.guild.icon,
      banner: ctx.guild.banner,
      splash: ctx.guild.splash,
      discoverySplash: ctx.guild.discovery_splash,
    },
    discord: {
      name: ctx.guild.name,
      ownerId: ctx.guild.owner_id,
      id: ctx.guild.id,
      features: ctx.guild.features,
      settings: {
        defaultMessageNotifications: ctx.guild.default_message_notifications,
        explicitContentFilter: ctx.guild.explicit_content_filter,
        verificationLevel: ctx.guild.verificationLevel,
        mfaLevel: ctx.guild.mfaLevel,
        afkChannelId: ctx.guild.afkChannelId,
        afkTimeout: ctx.guild.afkTimeout,
        rulesChannelId: ctx.guild.rules_channel_id,
        publicUpdatesChannelId: ctx.guild.public_updates_channel_id,
        systemChannelId: ctx.guild.system_channel_id,
        systemChannelFlags: ctx.guild.system_channel_flags,
        widgetChannelId: ctx.guild.widget_channel_id,
        widgetEnabled: ctx.guild.widget_enabled,
      },
      channels: [],
      roles: [],
      emojis: [],
      stickers: [],
      bans: [],
      members: [],
    },
    scheduleId: null,
    version: 3,
    createdAt: new Date().toISOString(),
    remote: true,
  };

  const findBackup = await ctx.database.findOne('backups', {code: backupCode});
  if (findBackup) await ctx.database.updateOne('backups', { code: backupCode }, { $set: bkObj });
  else await ctx.database.insertOne('backups', bkObj);
  
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.roles": ctx.guild.roles.sort((a,b) => b.position - a.position) } });
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.emojis": ctx.guild.emojis } });
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.stickers": ctx.guild.stickers } });
  
  // console.log("Asset Storage")
  // if (ctx.guild.icon) urltoBase64(ctx, ctx.guild.id, ctx.guild.iconURL({ extension: 'png' }), ctx.guild.name, 'servericon');
  // if (ctx.guild.banner) urltoBase64(ctx, ctx.guild.id, ctx.guild.bannerURL({ extension: 'png' }), ctx.guild.name, 'serverbanner');
  // if (ctx.guild.splash) urltoBase64(ctx, ctx.guild.id, ctx.guild.splashURL({ extension: 'png' }), ctx.guild.name, 'splash');
  // if (ctx.guild.discoverySplash) urltoBase64(ctx, ctx.guild.id, ctx.guild.discoverySplashURL({ extension: 'png' }), ctx.guild.name, 'discoverysplash');
  
  console.log("Channel Backup");
  const backupChannels = [];
  const channels = await ctx.dfetch(`guilds/${ctx.guild.id}/channels`);
  for (const channel of channels) {
    backupChannels.push({
      type: channel.type,
      name: channel.name,
      id: channel.id,
  
      parentId: "parent_id" in channel ? channel.parent_id : undefined,
  
      // Text Channels
      nsfw: "nsfw" in channel ? channel.nsfw : undefined,
      topic: "topic" in channel ? channel.topic : undefined,
      slowmode: "rate_limit_per_user" in channel ? channel.rate_limit_per_user : undefined,
  
      // Voice Channels
      userLimit: "user_limit" in channel ? channel.user_limit : undefined,
      bitrate: "bitrate" in channel ? channel.bitrate : undefined,
  
      permissionOverwrites: "permission_overwrites" in channel ? channel.permission_overwrites : undefined,
      messages: [],
      threads: [],
  
      position: channel.position,
    });
  
    // If its a text or news channel, backup the last 100 messages
    if (true || [0,2,5].some(x=>x == channel.type)) {
      console.log(`[Channel] Message Backup (${channel.id}) - Started`);
      
      try {
        const messages = [];
        for (let i=0;i<3;i++) {
          try {
            const msg = await ctx.dfetch(`channels/${channel.id}/messages?limit=100${messages.length > 0 ? `&before=${messages[messages.length-1].id}` : ''}`)
            console.log(`[Channel] Message Backup (${channel.id}) - ${messages.length}`);
            messages.push(...msg);
            if (msg.length != 100) break;
          } catch (err) {
            break;
          }
        }

        backupChannels.find(c => c.id === channel.id).messages = messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } catch (err) {
        if(!err.data.message == "Missing Access") {
          console.error(`[Channel] Message Backup Error (No Access:${channel.id})`);
        } else console.error(err.stack);
      }
      console.log(`[Channel] Message Backup (${channel.id}) - Finished`);
    }
  }
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.channels": backupChannels } });

  console.log("Member Backup");
  try {
    const members = await ctx.dfetch(`guilds/${ctx.guild.id}/members?limit=1000`);
    await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.members": members } });
  } catch (err) {
    console.log("Member Backup Error (Is Bot? Missing Intent?)")
    console.error(err.stack);
  }

  console.log("Bans Backup")
  try {
    const bans = await ctx.dfetch(`guilds/${ctx.guild.id}/bans?limit=1000`);
    await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.bans": bans } });
  } catch (err) {
    console.log("Bans Backup Error (No Access?)")
    console.error(err.stack);
  }

  // const shouldDelete = prompt("Delete? (y/n) ")
  // if (shouldDelete === "y") {
  //   console.log("Deleted backup");
  //   await ctx.database.deleteOne('backups', { code: backupCode });
  // }
}