'use strict';

// This Volumio plugin provides KBS(Korean Radio Station) and Linn radio.

var libQ = require('kew');
var fs = require('fs-extra');
var config = require('v-conf');
var unirest = require('unirest');

var KbsChannelName = [];
var LinnChannelUri = [];
var LinnChannelName = [];
var serviceName = "personal_radio";
var baseKbsStreamUrl = 'http://kong.kbs.co.kr/live_player/channelMini.php';

module.exports = ControllerPersonalRadio;

function ControllerPersonalRadio(context) {
	var self = this;

  self.context = context;
  self.commandRouter = this.context.coreCommand;
  self.logger = this.context.logger;
  self.configManager = this.context.configManager;
  self.state = {};
  self.stateMachine = self.commandRouter.stateMachine;

  self.logger.info("PersonalRadio::constructor");
}

ControllerPersonalRadio.prototype.onVolumioStart = function()
{
    var self = this;

    this.configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
    self.getConf(this.configFile);

    return libQ.resolve();
};

ControllerPersonalRadio.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerPersonalRadio.prototype.onStart = function() {
  var self = this;

  self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service','mpd');

  self.loadRadioI18nStrings();
  self.addToBrowseSources();

  LinnChannelUri.push(self.config.get("linnJazzUrl"));
  LinnChannelUri.push(self.config.get("linnRadioUrl"));
  LinnChannelUri.push(self.config.get("linnClassicUrl"));

  LinnChannelName.push(self.config.get("linnJazzName"));
  LinnChannelName.push(self.config.get("linnRadioName"));
  LinnChannelName.push(self.config.get("linnClassicName"));

  KbsChannelName.push('KBS1 FM');
  KbsChannelName.push('KBS2 FM');
  KbsChannelName.push(self.getRadioI18nString('KBS1_RADIO'));
  KbsChannelName.push(self.getRadioI18nString('KBS2_RADIO'));
  KbsChannelName.push(self.getRadioI18nString('KBS3_RADIO'));
  KbsChannelName.push('KBS DMB');
  KbsChannelName.push(self.getRadioI18nString('KBS_UNION'));
  KbsChannelName.push(self.getRadioI18nString('KBS_WORLD'));

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onStop = function() {
  var self = this;

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onRestart = function() {
  var self = this;

  return libQ.resolve();
};


// Configuration Methods -----------------------------------------------------
ControllerPersonalRadio.prototype.getConf = function(configFile) {
  var self = this;

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
};

ControllerPersonalRadio.prototype.setConf = function(varName, varValue) {
  var self = this;

  //Perform your installation tasks here
};


// Playback Controls ---------------------------------------------------------
ControllerPersonalRadio.prototype.addToBrowseSources = function () {
  var self = this;

  self.commandRouter.volumioAddToBrowseSources({
      name: self.getRadioI18nString('PLUGIN_NAME'),
      uri: 'root',
      plugin_type: 'music_service',
      plugin_name: "personal_radio",
      albumart: '/albumart?sourceicon=music_service/personal_radio/personal_radio.svg'
  });
};

ControllerPersonalRadio.prototype.handleBrowseUri = function (curUri) {
  var self = this;
  var defer =libQ.defer();
  var response;

  self.logger.info("PersonalRadio::handleBrowseUri");
  if (curUri.startsWith('root')) {
      if (curUri === 'root') { //root
          response = {
              "navigation": {
                  "lists": [
                      {
                          "availableListViews": [
                              'list'
                          ],
                          "items": [
                          ]
                      }
                  ],
                  "prev": {
                      "uri": '/'
                  }
              }
          };

          for (var i in KbsChannelName) {
            var channel = {
              service: serviceName,
              type: 'mywebradio',
              title: KbsChannelName[i],
              artist: '',
              album: '',
              icon: 'fa fa-music',
              uri: 'webkbs/'+ i
            };
            response.navigation.lists[0].items.push(channel);
          }
          for (var j in LinnChannelName) {
            var channel = {
              service: serviceName,
              type: 'mywebradio',
              title: LinnChannelName[j],
              artist: '',
              album: '',
              icon: 'fa fa-music',
              uri: 'weblinn/'+ j
            };
            response.navigation.lists[0].items.push(channel);
          }

          defer.resolve(response);
      }
  }

  return defer.promise;
};

ControllerPersonalRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();

  return self.mpdPlugin.sendMpdCommand('stop', [])
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('clear', []);
    })
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('add "'+track.uri+'"',[]);
    })
    .then(function () {
      self.commandRouter.pushToastMessage('info',
          self.getRadioI18nString('PLUGIN_NAME'),
          self.getRadioI18nString('WAIT_FOR_RADIO_CHANNEL'));

      return self.mpdPlugin.sendMpdCommand('play', []).then(function () {
        if (track.radioType === 'kbs') {
          return self.mpdPlugin.getState().then(function (state) {
            return self.commandRouter.stateMachine.syncState(state, serviceName);
          });
        }
        else {
          self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
          return libQ.resolve();
        }
      })
    })
    .fail(function (e) {
      return defer.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.seek = function (position) {
  var self = this;

  return self.mpdPlugin.seek(position);
};

ControllerPersonalRadio.prototype.stop = function() {
	var self = this;

  self.commandRouter.pushToastMessage('info', self.getRadioI18nString('PLUGIN_NAME'), self.getRadioI18nString('STOP_RADIO_CHANNEL'));
  return self.mpdPlugin.stop().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.pause = function() {
	var self = this;

  return self.mpdPlugin.pause().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.resume = function() {
  var self = this;

  // TODO don't send 'toggle' if already playing
  return self.mpdPlugin.resume().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();
  var uris = uri.split("/");
  var channel = parseInt(uris[1]);
  var response;

  if (uris[0] === 'webkbs') {
    self.getKbsStreamUrl(channel+1).then(function (kbsUri) {
      response = {
        uri: kbsUri,
        service: serviceName,
        name: KbsChannelName[channel],
        title: KbsChannelName[channel],
        type: 'track',
        trackType: self.getRadioI18nString('PLUGIN_NAME'),
        radioType: 'kbs',
        samplerate: '',
        bitdepth: '',
        albumart: '/albumart?sourceicon=music_service/personal_radio/kbs.svg'
      };
      defer.resolve(response);
    })
  }
  else if (uris[0] === 'weblinn') {
    response = {
      uri: LinnChannelUri[channel],
      service: serviceName,
      name: LinnChannelName[channel],
      type: 'track',
      trackType: self.getRadioI18nString('PLUGIN_NAME'),
      radioType: 'linn',
      albumart: '/albumart?sourceicon=music_service/personal_radio/linn.svg'
    };
    defer.resolve(response);
  }

  return defer.promise;
};

// Stream and resource controls ---------------------------------------------------------

ControllerPersonalRadio.prototype.getKbsStreamUrl = function (channel) {
    var self = this;
    var defer = libQ.defer();
    var userId;

    userId = Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6);

    var Request = unirest.get(baseKbsStreamUrl);
    Request.query({
        id: userId,
        channel: channel
    }).end(function (response) {
      if (response.status === 200) {
        var result = response.body.split("\n");
        var retCode = parseInt(result[0]);
        var streamUrl = result[1];

        if (retCode === 0) {
          defer.resolve(streamUrl);
        }
        else {
            self.commandRouter.pushToastMessage('info',
                self.getRadioI18nString('PLUGIN_NAME'),
                self.getRadioI18nString('ERROR_KBS_URL'));

            defer.resolve(null);
        }
      } else {
        defer.resolve(null);
      }
    });
    return defer.promise;
};

ControllerPersonalRadio.prototype.loadRadioI18nStrings = function () {
  var self=this;
  var language_code = this.commandRouter.sharedVars.get('language_code');

  self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
  self.i18nStringsDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
};

ControllerPersonalRadio.prototype.getRadioI18nString = function (key) {
  var self=this;

  if (self.i18nStrings[key] !== undefined)
    return self.i18nStrings[key];
  else
    return self.i18nStringsDefaults[key];
};