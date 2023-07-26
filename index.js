const backup = require('./remoteBackup/backup');
const config = require('./config.js');

backup(config.token, "GUILD");