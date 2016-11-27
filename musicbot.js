const config = require("./config.json")
const Discord = require("discord.js");
const yt = require("ytdl-core");
const client = new Discord.Client({forceFetchMembers: true});
const YouTube = require("simple-youtube-api");
const now = require("performance-now");
const yts = new YouTube(config.ytkey);
client.login(config.token);

var guildInfo = []

client.on("ready", () => {
	console.log("MusicBot is ready!")
	console.log("Initialising guilds...")
	client.guilds.forEach(function(x) {
		if (initGuild(x.id, false) === "success") {
			if (!config.adminlist.includes(x.owner.user.id)) {config.adminlist.push(x.owner.user.id)}
			console.log("Initialised " + x.name + " (" + x.id + ")\n╚ Added " + x.owner.user.username + " to adminlist.")
		} else {
			console.log("Failed to initialise " + x.name + " | " + x.id)
		}
	})
	// TODO Add config loading/saving from file
});

client.on("message", msg => {
	if (config.blacklist.includes(msg.author.id)) return;
	if (msg.channel.type === 'dm') return;

	var _guild = guildInfo.find(o => o.id === msg.guild.id)

	var guildPrefix = `${_guild ? _guild.general.prefix : config.defaultPrefix}`
	if (msg.isMentioned(client.user.id))
		return msg.reply("Use " + guildPrefix + "help for commands.");

	if (!msg.content.startsWith(guildPrefix)) return;

	var command = msg.content.substring(guildPrefix.length).toLowerCase().split(" ")[0];
	var args = msg.content.split(" ").slice(1).join(" ")

	if (command === "play" || command === "p") {
		if (!args) {
			return msg.channel.sendMessage("No link/search query provided.");
		}
		if (!_guild.general.mchannel) {
			_guild.general.mchannel = msg.channel;
		}
		if (_guild && !_guild.audio.voice) {
			if (!msg.member.voiceChannel) {
				return msg.reply("Join a voice channel first.");
			}
			_guild.audio.voice = msg.member.voiceChannel;
		}
		if (!_guild.audio.voice === msg.member.voiceChannel) {
			return msg.channel.sendMessage("You need to be in the JukeBot's voicechannel to queue.");
		}
		const sMsg = msg.channel.sendMessage("Gathering video metadata...");
		var query = args
		if (query.lastIndexOf("=") !== -1) {
			query = query.substring(query.lastIndexOf("=") + 1);
		}
		yts.searchVideos(query, 1).then(videos => {
			yts.getVideoByID(videos[0].id).then(video2 => {
				if (video2.durationSeconds > 7201) {msg.channel.sendMessage("Maximum video duration is 2 hours!"); setTimeout(() => {msg.delete(); sMsg.delete();}, 50); return;}
				setTimeout(() => {msg.delete()}, 50)
				queueSong(video2.id, video2.title, msg.author.id, video2.durationSeconds, _guild)
				if (_guild.audio.playing) {
					sMsg.then(m => m.edit(":white_check_mark: " + video2.title + " has been queued by " + msg.author.username))
				} else {
					playVideo(msg.guild.id)
					sMsg.then(m => m.delete());
				}
			}).catch((e) => {sMsg.then(m => m.edit(":grey_question: Couldn't fetch the video\n" + e)); console.log(e)});
		}).catch((e) => {sMsg.then(m => m.edit(":negative_squared_cross_mark: No search results found")); console.log(e)});
	}

	if (command === "undo") {
		let qItemIndex = _guild.audio.queue.indexOf(_guild.audio.queue.slice(1).reverse().find(o => o.user == msg.author.id))
		if (qItemIndex < 0) return msg.channel.sendMessage(":mag: No songs queued by you were found")
		let removedItem = _guild.audio.queue[qItemIndex]
		_guild.audio.queue.splice(qItemIndex, 1)
		msg.channel.sendMessage("Removed **" + removedItem.title + "**")
	}

	if (command === "prefix") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) return msg.channel.sendMessage("You don't have access to this command.")
		if (!_guild) return msg.channel.sendMessage("This guild has not yet been initialised");
		_guild.general.prefix = args
		msg.channel.sendMessage("Prefix set to: **" + args + "**")
	}

	if (command === "maninit") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) return msg.channel.sendMessage("You don't have access to this command.")
		if (!_guild) {
			if (initGuild(msg.guild.id, true) === "success") {
				_guild = guildInfo.find(o => o.id === msg.guild.id)
				msg.channel.sendMessage("Successfully initialised guild.")
			} else {
				return msg.channel.sendMessage("Failed to initialise guild.")
			}
		}
	}

	if (command === "stop" && _guild.audio.playing) {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) return msg.channel.sendMessage("You don't have access to this command.")
		_guild.audio.queue = ["09"];
		try{
			_guild.audio.dispatcher.end();
		}catch(e){
			console.log("Unable to stop")
		}
	}

	if (command === "pause") {
		try{
			var q = String.fromCharCode(34);
			_guild.audio.dispatcher.pause();
			msg.channel.sendMessage(":pause_button: Paused " + q + _guild.general.videoinf.title + q)
		} catch(e) {
			msg.channel.sendMessage(":x: Unable to pause!")
		}
	}

	if (command === "resume") {
		try{
			var q = String.fromCharCode(34);
			_guild.audio.dispatcher.resume();
			msg.channel.sendMessage(":arrow_forward: Resumed " + q + _guild.general.videoinf.title + q)
		}catch(e){
			msg.channel.sendMessage(":x: Unable to resume!")
		}
	}

	if (command === "now") {
		if (!_guild.audio.playing)
			return msg.channel.sendMessage("There is nothing playing.");

		var song = _guild.audio.queue[0]
		var playTime = getDur((_guild.audio.dispatcher.time).toFixed(0) / 1000)
		msg.channel.sendMessage("Now playing: " + song.title + " (" + playTime + "/" + getDur(song.duration) + ", " + getDur(Math.floor((Math.abs(new Date('01/01/2012 ' + getDur(song.duration)) - new Date('01/01/2012 ' + playTime)) / 1000) / 60)) + " left), queued by " + client.guilds.get(_guild.id).members.get(song.user).user.username + "\n*http://youtube.com/watch?v=" + song.video + "*")
	}

	if (command === "queue" || command === "q") {
		if (!_guild) return;
		if (_guild.audio.queue.length > 1) {
			let page = args
			let maxPage = Math.ceil(_guild.audio.queue.length / 10)
			if (page < 1) page = 1;
			if (page > maxPage) page = maxPage;
			let startQueue = ((page - 1) * 10) + 1
			let endQueue = `${(startQueue + 10) > _guild.audio.queue.length ? _guild.audio.queue.length : (startQueue + 10)}`
			let song = _guild.audio.queue[0]
			let playTime = getDur((_guild.audio.dispatcher.time).toFixed(0) / 1000)
			var chText = "**Now playing: **" + song.title + " (" + playTime + "/" + getDur(song.duration) + ", " + getDur(Math.floor((Math.abs(new Date('01/01/2012 ' + getDur(song.duration)) - new Date('01/01/2012 ' + playTime)) / 1000) / 60)) + " left), queued by " + client.guilds.get(_guild.id).members.get(song.user).user.username + "\n\n" + "**" + (_guild.audio.queue.length - 1) + " songs queued up**\n";
			var totalDuration = 0
			for (i = startQueue; i < endQueue; i++) {
				let songs = _guild.audio.queue[i]
				chText += "**" + i + "** | *" + songs.title + "*  |  Queued by: " + client.guilds.get(_guild.id).members.get(songs.user).user.username + "\n"
				totalDuration += parseInt(songs.duration)
			}

			chText += "\n**Total Duration:** " + getDur(totalDuration)
			msg.channel.sendMessage(chText)
		} else {
			msg.channel.sendMessage("There are no songs in the queue! Consider adding some.")
		}
	}

	if (command === "unqueue") {
		if (_guild.audio.queue.length > 1) {
			var uqargs = parseInt(msg.content.split(" ").slice(1)[0])
			if (isNaN(uqargs) || uqargs < 1 || uqargs > _guild.audio.queue.length - 1) return msg.channel.sendMessage("Invalid position specified.")
			if (_guild.audio.queue[uqargs].user === msg.author.id || msg.author.id === config.ownerID || config.adminlist.includes(msg.author.id)) {
				_guild.audio.queue.splice(uqargs, 1)
				msg.channel.sendMessage("Song removed successfully.")
			} else {
				msg.channel.sendMessage("You didn't queue that.")
			}
		} else {
			msg.channel.sendMessage("There is nothing to unqueue.")
		}
	}

	if (command === "op") {
		if (msg.author.id !== config.ownerID) {
			return msg.channel.sendMessage("You don't have access to this command.")
		}
		var idparam = args
		if (idparam.startsWith("-")) {
			if (!config.adminlist.includes(idparam.substring(1))) {
				return msg.channel.sendMessage("That user is not an admin!")
			}
			if (config.adminlist.includes(msg.author.id)) {
				return msg.channel.sendMessage("You cannot de-op other admins.")
			}
			config.adminlist.splice(config.adminlist.indexOf(idparam.substring(1)), 1)
		} else {
			if (config.adminlist.includes(idparam)) {
				return msg.channel.sendMessage("That user is already an admin!")
			}
			config.adminlist.push(idparam)
		}
		msg.channel.sendMessage("Admins updated successfully!")
	}

	if (command === "block") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) {return msg.channel.sendMessage("You don't have access to this command.")}
		var idparam = args
		if (idparam.startsWith("-")) {
			if (!config.blacklist.includes(idparam.substring(1))) {return msg.channel.sendMessage("That user is not blacklisted!")}
			config.blacklist.splice(config.blacklist.indexOf(idparam.substring(1)), 1)
		} else {
			if (config.ownerID === idparam || config.adminlist.includes(idparam)) {return msg.channel.sendMessage("You can't blacklist an admin.")}
			if (config.blacklist.includes(idparam)) {return msg.channel.sendMessage("That user is already blacklisted!")}
			config.blacklist.push(idparam)
		}
		msg.channel.sendMessage("Blacklist updated successfully!")
	}

	if (command === "vol") {
		if (!_guild.audio.playing) return;
		try{
			var volume = args
			if (args.length < 1) {return msg.channel.sendMessage(":speaker: The volume is currently set to " + _guild.audio.dispatcher.volume);}
			if (isNaN(volume)) return msg.channel.sendMessage(":negative_squared_cross_mark: That's not a valid number!");
			if (volume > 4) {
				if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) {
					volume = 4;
				}
			} else if (volume < 0) {
				volume = 0;
			}
			_guild.audio.dispatcher.setVolume(volume)
			_guild.audio.volume = volume
			msg.channel.sendMessage(":speaker: Volume set to " + volume)
		}catch(e){
			msg.channel.sendMessage(":negative_squared_cross_mark: Unable to set volume\n" + e)
		}
	}

	if (command === "skip") {
		let forceSkip = false;
		if (msg.member.voiceChannel !== _guild.audio.voice) return msg.channel.sendMessage("You need to be in the bot's voice channel to skip!")
		if (!_guild.audio.playing) return msg.channel.sendMessage("The bot is not playing anything!")
		if (args.toLowerCase().includes("f") && (msg.author.id === config.ownerID || config.adminlist.includes(msg.author.id))) {forceSkip = true};
		if (_guild.general.skip.voters.includes(msg.author.id) && !forceSkip) return msg.channel.sendMessage("You've already voted!");
		_guild.general.skip.count++;
		_guild.general.skip.voters.push(msg.author.id);
		if (_guild.general.skip.count >= Math.round((_guild.audio.voice.members.size - 1) / 2) || forceSkip) {
			if (forceSkip) {msg.channel.sendMessage(msg.author.username + " has force skipped.")}
			try{
				_guild.audio.dispatcher.end();
				_guild.audio.playing = false
				_guild.general.skip.count = 0;
				_guild.general.skip.voters = [];
			}catch(e){
				msg.channel.sendMessage(":negative_squared_cross_mark: Unable to skip!")
			}
		} else {
			let neededVotes = Math.round((_guild.audio.voice.members.size - 1) / 2) - _guild.general.skip.count
			msg.channel.sendMessage(`Vote acknowledged.**\n${neededVotes} ${neededVotes > 1 ? "votes" : "vote"} needed to skip**`);
		}
	}

	if (command === "save") {
		if (!_guild) return;
		if (_guild.audio.playing) {
			var song = _guild.audio.queue[0]
			msg.member.sendMessage("Title: " + song.title +
														"\n" + "Duration: " + song.duration + "\n" +
														"URL: <https://www.youtube.com/watch?v=" + song.video + ">")
			msg.reply(":white_check_mark: You have been DM'd the video info!")
		} else {
			msg.channel.sendMessage(":negative_squared_cross_mark: You can't save a song that's not playing!")
		}
	}


	if (command === "speechdip") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) {return msg.channel.sendMessage("You don't have access to this command.")}
		_guild.audio.voicedip = !_guild.audio.voicedip
		msg.channel.sendMessage(`Toggled voice detection: ${_guild.audio.voicedip ? 'on' : 'off'}`)
		try{
			if (_guild.audio.playing) {
				_guild.audio.dispatcher.setVolume("1");
			}
		}catch(e){
			console.log(e)
		}
	}

	if (command === "list") {
		if (!args) return msg.channel.sendMessage("No link/search query provided.");
		if (!_guild.general.mchannel) { _guild.general.mchannel = msg.channel }
		if (_guild && !_guild.audio.voice) {
			if (!msg.member.voiceChannel) {
				return msg.reply("Join a voice channel first.");
			}
			_guild.audio.voice = msg.member.voiceChannel
		}
		if (!_guild.audio.voice === msg.member.voiceChannel)
			return msg.channel.sendMessage("You need to be in the JukeBot's voicechannel to queue.")
		const sMsg = msg.channel.sendMessage("Adding videos to queue...")
		var query = args
		var mInfo = msg.author.username + "#" + msg.author.discriminator
		if (query.lastIndexOf("=") !== -1) {
			query = query.substring(query.lastIndexOf("=") + 1)
		}
		query = query.replace(/>|</g, "")
		yts.getPlaylist(query).then(playlist => {
			playlist.getVideos().then(videos => {
				sMsg.then(m => {m.edit("Adding videos to queue... (" + videos.length + ")")})
				for (i = 0; i < videos.length; i++) {
					yts.searchVideos(videos[i].id, 1).then(videos1 => {
						yts.getVideoByID(videos1[0].id).then(video2 => {
							if (video2.durationSeconds < 7201) {
								queueSong(video2.id, video2.title, msg.author.id, video2.durationSeconds, _guild)
							}
						}).catch((e) => {console.log(e)});
					}).catch((e) => {console.log(e)});
				}
				sMsg.then(m => {m.edit("Successfully imported playlist: " + playlist.title)})
				setTimeout(() => {msg.delete()}, 50)
				if (!_guild.audio.playing) {
					playVideo(msg.guild.id)
				}
			}).catch((e) => {console.log(e)});
		}).catch((e) => {console.log(e)});
	}

	if (command === "e") {
		if (msg.author.id === config.ownerID) {
			var code = args
			try {
				var evaled = eval(code);
				if (typeof evaled !== 'string')
					evaled = require('util').inspect(evaled);
					msg.channel.sendMessage(code + "\n```xl\n" + clean(evaled) + "\n```");
			}
			catch(err) {
				msg.channel.sendMessage(code + "\n`ERROR` ```xl\n" + clean(err) + "\n```");
			}
		}
	}

	if (command === "help") {
		let embed = {
			color: 3447003,
			author: {
				name: "[ COMMANDS ]"
			},
			description: "Prefix: " + guildPrefix + "\n\u200B",
			fields: [
				{
					name: '__Playback__',
					value: "play/p, pause, resume, stop, skip, list, vol, speechdip"
				},
				{
					name: '__General__',
					value: "queue/q, unqueue, undo/z, now, save, invite"
				},
				{
					name: '__Admin__',
					value: "op, block, move, cleanup, announce"
				},
				{
					name: '__Debugging__',
					value: "e, stats, ping, maninit, prefix, reboot\n\u200B"
				},
			],
			timestamp: new Date(),
			footer: {
				icon_url: client.user.avatarURL,
				text: client.user.username
			}
		};
		msg.channel.sendMessage("", {embed})
	}

	if (command === "announce") {
		if (msg.author.id !== config.ownerID) return msg.channel.sendMessage("You don't have access to this command.")
		if (!args) return msg.channel.sendMessage("No message text specified. Announce cancelled.");
		Announce(args)
	}

	if (command === "move") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) return msg.channel.sendMessage("You don't have access to this command.")
		let userMentioned = msg.mentions.users.first();
		let specifiedName = msg.content.split(" ").slice(2).join(" ")
		if (specifiedName === "here") {
			if (!msg.member.voiceChannel) return msg.channel.sendMessage("You're not in a voice channel.")
			msg.guild.member(userMentioned).setVoiceChannel(msg.member.voiceChannel)
		} else {
			if (rooms.has(specifiedName)) {specifiedName = rooms.get(specifiedName)}
			let vCName = msg.guild.channels.filter(channel => channel.type === 'voice' && channel.name === specifiedName).first();
			msg.guild.member(userMentioned).setVoiceChannel(vCName);
		}
	}

	if (command === "reboot") {
		if (msg.author.id !== config.ownerID && !config.adminlist.includes(msg.author.id)) {return msg.channel.sendMessage("You don't have access to this command.")}
		msg.channel.sendMessage("**Rebooting...**")
		Announce(msg.author.username + " has initiated a reboot! Please standby...")
		setTimeout(() => {process.exit();}, 5000)
	}

	if (command === "ping") {
		setTimeout(msg.delete.bind(msg), 50);
		var startTime = now();
		msg.channel.sendMessage("Pinging...").then(message => {
			var endTime = now();
			let difference = (endTime - startTime).toFixed(2);
			var unit = "ms";
			if (difference > 999) {
				difference = difference / 1000
				unit = "s"
			}
			message.edit("Ping took: " + difference + unit)
		});
	}

	if (command === "cleanup") {
		if (config.ownerID !== msg.author.id && !config.adminlist.includes(msg.author.id)) return msg.channel.sendMessage("You don't have access to this command.")
		let messagecount = parseInt(args) ? parseInt(args) : 1;
		msg.channel.fetchMessages({limit: 100}).then(messages => {
			let msg_array = messages.array();
			msg_array = msg_array.filter(m => m.author.id === client.user.id);
			if (msg_array.length > messagecount) {
				msg_array.length = messagecount;
			}
			if (msg_array.length < 2) {
				msg_array.map(m => m.delete().catch(console.error));
				msg.channel.sendMessage(":white_check_mark: Messages deleted.").then(m => {
					setTimeout(() => {m.delete();}, 2000)
				});
			} else {
				msg.channel.bulkDelete(msg_array).then(() => {
					msg.channel.sendMessage(":white_check_mark: Messages deleted.").then(m => {
						setTimeout(() => {m.delete();}, 2000)
					});
				}).catch((e) => {
					msg.channel.sendMessage(":x: Unable to delete messages.\nReason: " + e)
				})
			};
		});
	}

	if (command === "stats") {
		let embed = {
			color: 3447003,
			author: {
				name: "MusicBot v" + config.version
			},
			fields: [
				{
					name: '__Uptime__',
					value: (process.uptime() / 60).toFixed(0) + " minute(s)"
				},
				{
					name: '__RAM Usage__',
					value: ((process.memoryUsage().heapUsed / 1024) / 1024).toFixed(0) + " MB"
				},
				{
					name: '__System__',
					value: process.platform + " (" + process.arch + ")"
				},
				{
					name: '__Node Version__',
					value: process.version
				},
				{
					name: '__Discord.js Version__',
					value: Discord.version
				},
				{
					name: '__Serving__',
					value: client.guilds.size + ' guilds' + '\n\u200B'
				}
			],
			timestamp: new Date(),
			footer: {
				icon_url: client.user.avatarURL,
				text: client.user.username
			}
		};
		msg.channel.sendMessage("", {embed});
	}

	if (command === "invite") {
		msg.channel.sendMessage("Invite me to your server!\n" + config.invite)
	}
});


client.on("guildMemberSpeaking", (member, speaking) => {
	var _guild = guildInfo.find(o => o.id === member.guild.id)
	if (!_guild) return;
	if (!_guild.audio.voicedip) return;
	if (!_guild.audio.playing) return;
	if (speaking) {
		_guild.audio.dispatcher.setVolume("0.025");
	} else {
		try{
			if (member.guild.members.filter(c => c.speaking).size === 0) {_guild.audio.dispatcher.setVolume(_guild.audio.volume)};
		} catch(e){
			console.log(e)
		};
	};
});


function playVideo(gid) {
	var _guild = guildInfo.find(o => o.id === gid)
	_guild.audio.voice.join().then(connection => {
		var song = _guild.audio.queue[0]// 0 = URL, 1 = Queuer, 2 = Title, 3 = Duration
		let stream = yt(song.video, {audioonly: true});
		_guild.general.mchannel.sendMessage("Now playing: **" + song.title + "** (" + getDur(song.duration) + "), queued by " + client.guilds.get(gid).members.get(song.user).user.username);
		_guild.general.videoinf.title = song.title
		_guild.general.videoinf.url = song.video
		_guild.audio.dispatcher = connection.playStream(stream);
		_guild.audio.playing = true;
		try{
			_guild.audio.dispatcher.setVolume(_guild.audio.volume)
		}catch(e){
			console.log(e)
		}
		_guild.audio.dispatcher.on('end', () => {
			_guild.audio.playing = false;
			_guild.audio.queue.splice(0, 1)
			_guild.general.skip.count = 0;
			_guild.general.skip.voters = [];
			var q = String.fromCharCode(34);
			if (_guild.audio.queue.length > 0) {
				_guild.general.mchannel.sendMessage(q + _guild.general.videoinf.title + q + " has finished. Playing next song in queue.")
				playVideo(_guild.id)
			} else {
				_guild.general.mchannel.sendMessage(q + _guild.general.videoinf.title + q + " has finished. Add more songs to the queue!").then(m => {m.member.voiceChannel.leave()});
				_guild.general.mchannel = undefined
				_guild.audio.voice = undefined
			}
		});
	});
}

function queueSong(vid, title, user, duration, guild) {
	try{
		var ob = {
			"user" : user,
			"video" : vid,
			"title" : title,
			"duration" : duration
		}
		guild.audio.queue.push(ob)
	return "success"
	}catch(e){
		console.log(e)
		return "fail"
	}
}

function initGuild(guildID, log) {
	try{
		var ob = {
			"id" : guildID,
			"general" : {
				"mchannel" : undefined,
				"dchannel" : undefined,
				"prefix" : config.defaultPrefix,
				"videoinf" : {
					"title" : undefined,
					"url" : undefined
				},
				"skip" : {
					"count" : 0,
					"voters" : []
				},
			},
			"audio" : {
				"playing" : false,
				"queue" : [],
				"voice" : undefined,
				"dispatcher" : undefined,
				"volume" : 1,
				"voicedip" : false
			}
		}
		guildInfo.push(ob)
		if (log === true) {console.log("Initialised guild: " + guildID)}
		return "success"
	}catch(e){
		console.log(e)
		return "fail"
	}
}

function getDur(tme) {
	let dur = new Date(tme * 1000).toISOString().substr(11, 8);
	let hrs = dur.substring(0,2)
	if (hrs === "00") {
		return dur.substring(3)
	} else {
		return dur
	}
}

function Announce(text) {
	client.guilds.forEach(function(x) {
		try {
			let _guild = guildInfo.find(o => o.id === x.id)
			let channel = x.dchannel || x.mchannel || x.defaultChannel
			channel.sendMessage(text)
		} catch(e) {
			console.log(e)
		}
	});
}

function clean(text) {
	if (typeof(text) !== "string") return text;

	return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
}

var rooms = new Map([
	//*cough*
]);

process.on('uncaughtException', function(err) {
	if (err.code == 'ECONNRESET') {
		console.log('Got an ECONNRESET! This is *probably* not an error. Stacktrace:');
		console.log(err.stack);
	} else {
		console.log(err);
		console.log(err.stack);
		process.exit(0);
	}
});
