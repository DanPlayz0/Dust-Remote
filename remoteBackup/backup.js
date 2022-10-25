const axios = require('axios');

const createCode = (length) => {
  let alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", code = "";
  for (let i = 0; i < length; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const backupServer = async (client, guild) => {
  const ctx = {};
  ctx.guild = client.guilds.cache.get(guild);
  ctx.database = new (require('./Database'))(client);
  await ctx.database.init();
  const backupCode = createCode(21);
  console.log("Creating backup with code: "+ backupCode);
  await createBackup(ctx, backupCode);
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
    userid: "1028716656404471828",
    access: ["209796601357533184"],
    name: ctx.guild.name,
    assets: {
      icon: ctx.guild.iconURL({ extension: 'png' }),
      banner: ctx.guild.bannerURL({ extension: 'png' }),
      splash: ctx.guild.splashURL({ extension: 'png' }),
      discoverySplash: ctx.guild.discoverySplashURL({ extension: 'png' }),
    },
    discord: {
      name: ctx.guild.name,
      ownerId: ctx.guild.ownerId,
      id: ctx.guild.id,
      features: ctx.guild.features,
      settings: {
        defaultMessageNotifications: ctx.guild.defaultMessageNotifications,
        explicitContentFilter: ctx.guild.explicitContentFilter,
        verificationLevel: ctx.guild.verificationLevel,
        mfaLevel: ctx.guild.mfaLevel,
        afkChannelId: ctx.guild.afkChannelId,
        afkTimeout: ctx.guild.afkTimeout,
        systemChannelId: ctx.guild.systemChannelId,
        rulesChannelId: ctx.guild.rulesChannelId,
        publicUpdatesChannelId: ctx.guild.publicUpdatesChannelId,
        systemChannelFlags: ctx.guild.systemChannelFlags.bitfield,
      },
      channels: [],
      roles: [],
      emojis: [],
      stickers: [],
      bans: [],
      members: [],
    },
    scheduleId: null,
    version: 2,
    createdAt: new Date().toISOString(),
    remote: true,
  };

  await ctx.database.insertOne('backups', bkObj);
  
  console.log("Asset Storage")
  if (ctx.guild.icon) urltoBase64(ctx, ctx.guild.id, ctx.guild.iconURL({ extension: 'png' }), ctx.guild.name, 'servericon');
  if (ctx.guild.banner) urltoBase64(ctx, ctx.guild.id, ctx.guild.bannerURL({ extension: 'png' }), ctx.guild.name, 'serverbanner');
  if (ctx.guild.splash) urltoBase64(ctx, ctx.guild.id, ctx.guild.splashURL({ extension: 'png' }), ctx.guild.name, 'splash');
  if (ctx.guild.discoverySplash) urltoBase64(ctx, ctx.guild.id, ctx.guild.discoverySplashURL({ extension: 'png' }), ctx.guild.name, 'discoverysplash');
  
  console.log("Channel Backup");
  const backupChannels = [];
  for (const [, channel] of ctx.guild.channels.cache) {
    backupChannels.push({
      type: channel.type,
      name: channel.name,
      id: channel.id,
  
      parentId: "parentId" in channel ? channel.parentId : undefined,
  
      // Text Channels
      nsfw: "nsfw" in channel ? channel.nsfw : undefined,
      topic: "topic" in channel ? channel.topic : undefined,
      slowmode: "rateLimitPerUser" in channel ? channel.rateLimitPerUser : undefined,
  
      // Voice Channels
      userLimit: "userLimit" in channel ? channel.userLimit : undefined,
      bitrate: "bitrate" in channel ? channel.bitrate : undefined,
  
      permissionOverwrites: [],
      messages: [],
      threads: [],
  
      position: channel.rawPosition,
    });
  
    // Push that channels permissions to the array
    if (channel?.permissionOverwrites?.cache)
      for (const [, perm] of channel.permissionOverwrites.cache) {
        const role_member = ctx.guild.roles.cache.get(perm.id) == undefined ? undefined : ctx.guild.roles.cache.get(perm.id).name
  
        backupChannels.find(c => c.id === channel.id).permissionOverwrites.push({
          roleName: role_member,
          type: perm.type,
          allow: Number(perm.allow),
          deny: Number(perm.deny),
        });
      }
  
  
    // If its a text or news channel, backup the last 100 messages
    if ([0,2,5].some(x=>x == channel.type) && channel.permissionsFor(ctx.guild.members.me.id).has("ViewChannel")) {
      console.log(`[Channel] Message Backup (${channel.id})`);
      
      try {
        const msgs = (await channel.messages.fetch({ limit: 100 })).toJSON().sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  
        for (const msg of msgs) {
          const jsonMSG = msg.toJSON();
          backupChannels.find(c => c.id === channel.id).messages.push({
            author: {
              id: msg.author.id,
              username: msg.author.username,
              bot: msg.author.bot,
              discriminator: msg.author.discriminator,
              avatar: msg.author.avatar,
              avatarURL: msg.author.displayAvatarURL({ format: 'png', dynamic: true }),
              highestRole: {
                name: msg.member?.roles?.highest?.name,
                id: msg.member?.roles?.highest?.id,
                color: msg.member?.roles?.highest?.hexColor,
              }
            },
  
            content: msg.content,
            createdTimestamp: msg.createdTimestamp,
            type: msg.type,
  
            embeds: jsonMSG.embeds,
            attachments: msg.attachments,
            stickers: jsonMSG.stickers,
            components: jsonMSG.components
          });
        }
      } catch (err) {
        if(!err.message.includes("Missing Access")) {
          console.error(`[Channel] Message Backup Error (${channel.id})`);
          console.error(err.stack);
        }
      }
    }
  }
  
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.channels": backupChannels } });
  
  console.log("Role Backup");
  let backupRoles = [];
  await ctx.guild.roles.fetch();
  for (const [, role] of ctx.guild.roles.cache) {
    backupRoles.push({
      name: role.name,
      id: role.id,
      permission: Number(role.permissions),
      position: role.position,
      color: role.hexColor,
      hoist: role.hoist,
      mentionable: role.mentionable,
      icon: role.iconURL(),
      unicodeEmoji: role.unicodeEmoji,
      managed: role.managed,
      members: role.members.map(x=>x.user.id),
    });
    if (role.icon) urltoBase64(ctx, role.id, role.iconURL(), role.name, 'roleicon');
  };
  backupRoles = backupRoles.sort((a, b) => b.position - a.position);
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.roles": backupRoles } });

  console.log("Member Backup");
  let backupMembers = [];
  for (const [, member] of ctx.guild.members.cache) {
    backupMembers.push({
      avatar: member.avatar,
      avatar: member.displayAvatarURL({ extension: 'png', dynamic: true }),
      roles: member._roles,
      nickname: member.nickname,
      joinedTimestamp: member.joinedTimestamp,
      joinedAt: member.joinedAt,
      premiumSinceTimestamp: member.premiumSinceTimestamp,
      user: {
        id: member.user.id,
        username: member.user.username,
        bot: member.user.bot,
        discriminator: member.user.discriminator,
        avatar: member.user.avatar,
        avatarURL: member.user.displayAvatarURL({ extension: 'png', dynamic: true }),
      }
    });
  };
  backupMembers = backupMembers.sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
  
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.members": backupMembers } });
  
  console.log("Emoji Backup");
  const backupEmojis = [];
  for (const [, emoji] of ctx.guild.emojis.cache) {
    backupEmojis.push({
      id: emoji.id,
      name: emoji.name,
      createdAt: emoji.createdAt,
      url: emoji.url,
    });
    urltoBase64(ctx, emoji.id, emoji.url, emoji.name, 'emoji');
  }
  
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.emojis": backupEmojis } });
  
  console.log("Sticker Backup");
  const backupStickers = [];
  for (const [, sticker] of ctx.guild.stickers.cache) {
    backupStickers.push({
      id: sticker.id,
      name: sticker.name,
      description: sticker.description,
      format: sticker.format,
      tags: sticker.tags,
      createdAt: sticker.createdAt,
      url: sticker.url,
    });
    urltoBase64(ctx, sticker.id, sticker.url, sticker.name, 'sticker');
  }
  
  await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.stickers": backupStickers } });
  
  // const backupBans = [];
  // const Bans = await ctx.guild.bans.fetch();
  // for (const [, ban] of Bans) {
  //   backupBans.push({
  //     reason: ban.reason,
  //     user: {
  //       id: ban.user.id,
  //       username: ban.user.username,
  //       bot: ban.user.bot,
  //       discriminator: ban.user.discriminator,
  //       avatar: ban.user.avatar,
  //       avatarURL: ban.user.displayAvatarURL({ format: 'png', dynamic: true })
  //     }
  //   });
  // };
  
  // await ctx.database.updateOne('backups', { code: backupCode }, { $set: { "discord.bans": backupBans } });

  // await ctx.database.deleteOne('backups', { code: backupCode });
}