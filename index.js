const Discord = require('discord.js');
const client = new Discord.Client({ intents: Object.keys(Discord.GatewayIntentBits) });
const backup = require('./remoteBackup/backup');
client.config = require('./config.js');

client.on('ready', async () => {
  await backup(client, "GUILD_ID");
  client.destroy();
  process.exit();
});

client.login(client.config.token);